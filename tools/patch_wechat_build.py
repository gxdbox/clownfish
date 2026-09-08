#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""微信小游戏构建后补丁（headless 构建不会写这些配置，每次构建后必须执行）。

用法: python3 tools/patch_wechat_build.py [build_dir]
默认 build_dir = /Users/pony/Documents/game/clownfish-cocos/build/wechatgame

补丁内容:
1. game.json: deviceOrientation=landscape（headless CLI 无法注入 orientation）
2. 分包 bundle 目录从 assets/<name>/ 移动到 subpackages/<name>/
   （Cocos 引擎 wx adapter 对 subpackages 列表内的 bundle 硬编码基路径 subpackages/<name>/，
   放在 assets/ 下会 readFile:fail subpackages/<name>/config.json）
3. game.json: subpackages 声明（root=subpackages/<name>/；headless 不写）
4. 每个分包 root 下放占位 game.js（微信开发者工具模拟器硬校验:
   "未找到 subpackages[i].root 对应的 game.js"，运行时不会执行它）
5. src/settings.json: assets.subpackages 列表（引擎加载 bundle 前先 wx.loadSubpackage）
6. 分包 bundle 的 prerequisite-imports 注册注入主包 game.js：
   Cocos 引擎在 loadBundle(<name>) 创建 bundle 时无条件 import('virtual:///prerequisite-imports/<name>')
   （见 engine/cocos/asset/asset-manager/factory.ts createBundle）。
   该模块只 System.register 在分包 bundle 的 index.js 里，而微信运行时从不执行分包 JS
   （分包分支只 loadSubpackage + 读 config.json，不 require index.js）
   → 不注入则报 "Unable to instantiate virtual:///prerequisite-imports/<name> from undefined"，
   这正是分包后 BGM 全静音的根因。修复：把 subpackages/<name>/index.js 的注册代码
   搬到主包 game.js（system.bundle.js require 之后，此时 SystemJS 全局可用）。
7. project.config.json: appid（工具 leveldb 项目记录已同步修正，此处双保险）
"""
import json
import os
import shutil
import sys

DEFAULT_BUILD = '/Users/pony/Documents/game/clownfish-cocos/build/wechatgame'
APPID = 'wx3e4ad4825796bb00'
SUBROOT = 'subpackages'
# 仅 bgm 分包：resources 含全部脚本导出（virtual:///prerequisite-imports/resources 需在主包内注册），
# 放分包会 "Unable to instantiate virtual:///prerequisite-imports/resources from undefined"（引擎不加载分包 bundle 的 index.js）
SUBPACKAGES = ['bgm']
PLACEHOLDER = ('// 分包占位入口：微信开发者工具校验 subpackages[].root 下必须存在 game.js；\n'
               '// 运行时不会被执行（小游戏唯一入口是主包 game.js），仅用于通过编译/预览校验。\n')
# 主包 game.js 中 SystemJS 加载完成后的注入锚点
GAME_JS_SYSTEMJS_ANCHOR = 'require("src/system.bundle.js");'
INJECT_MARKER = '// <clownfish: injected subpackage bundle registrations>'


AUDIO_EXTS = ('.m4a', '.mp3', '.aac', '.ogg', '.wav', '.pcm')


def check_build_health(b: str) -> list[str]:
    """构建产物健康检查（早发现"构建出空包/分包缺音频"这类静默问题，返回警告列表）。

    - 主包 scenes 为空 → 场景没进包（黑屏，Mac mini 曾出现：library 未导入导致空 build）
    - resources bundle 无任何 import 资源 → 精灵贴图没进包
    - bgm 分包无音频文件 → BGM 静音（此前"分包结构齐但 m4a 未进包"的根因）
    """
    warns: list[str] = []

    def bundle_cfg(root: str):
        p = os.path.join(root, 'config.json')
        if not os.path.isfile(p):
            return None
        try:
            return json.load(open(p))
        except Exception:
            return None

    def count_files(root: str) -> int:
        n = 0
        for _, _, fs in os.walk(root):
            n += len(fs)
        return n

    # 主包场景
    main_cfg = bundle_cfg(os.path.join(b, 'assets', 'main'))
    if main_cfg is not None:
        scenes = main_cfg.get('scenes') or {}
        if not scenes:
            warns.append('主包 assets/main/config.json 无 scenes（场景没进包 → 黑屏），请检查 Cocos 构建是否完整（library 导入是否成功）')
    else:
        warns.append('主包 assets/main/config.json 缺失')

    # resources 精灵
    res_cfg = bundle_cfg(os.path.join(b, 'assets', 'resources'))
    res_import = os.path.join(b, 'assets', 'resources', 'import')
    if res_cfg is not None:
        import_ver = res_cfg.get('versions', {}).get('import') or []
        import_files = count_files(res_import)
        if not import_ver and import_files == 0:
            warns.append('resources bundle 无任何 import 资源（精灵贴图没进包），请检查构建是否完整')

    # bgm 分包音频
    for name in SUBPACKAGES:
        sp = os.path.join(b, SUBROOT, name)
        if not os.path.isdir(sp):
            warns.append(f'分包 {SUBROOT}/{name}/ 不存在')
            continue
        audio_files = 0
        for r, _, fs in os.walk(sp):
            for f in fs:
                if f.lower().endswith(AUDIO_EXTS):
                    audio_files += 1
        cfg = bundle_cfg(sp)
        native_ver = cfg.get('versions', {}).get('native') or [] if cfg else []
        if audio_files == 0 and not native_ver:
            warns.append(f'分包 {SUBROOT}/{name}/ 内没有任何音频文件（versions.native 为空）→ BGM 静音；'
                         '请确认 assets/bgm/ 下 m4a 已正确导入并参与该 bundle 构建')
    return warns


def inject_subpackage_registrations(b: str, names: list[str]) -> None:
    """把分包 bundle index.js 里的 System.register 注册代码搬到主包 game.js。

    Cocos 引擎 loadBundle(<name>) 时 import('virtual:///prerequisite-imports/<name>')，
    该模块只注册在分包目录的 index.js 里，微信运行时不会执行分包 JS → 必须搬到主包。
    """
    gp = os.path.join(b, 'game.js')
    if not os.path.isfile(gp):
        return
    js = open(gp, encoding='utf-8').read()
    if INJECT_MARKER in js:
        return  # 幂等：已注入过
    reg = []
    for name in names:
        idx = os.path.join(b, SUBROOT, name, 'index.js')
        if os.path.isfile(idx):
            reg.append(open(idx, encoding='utf-8').read())
    if not reg:
        return
    body = '\n'.join(ln for src in reg for ln in src.splitlines())
    block = (f'\n{INJECT_MARKER}\n'
             '(function () {\n'
             '    try {\n'
             + '\n'.join('        ' + ln for ln in body.splitlines()) + '\n'
             '    } catch (e) { console.warn("[Clownfish] subpackage reg inject:", e); }\n'
             '})();\n')
    if GAME_JS_SYSTEMJS_ANCHOR in js:
        js = js.replace(GAME_JS_SYSTEMJS_ANCHOR, GAME_JS_SYSTEMJS_ANCHOR + block, 1)
    else:
        js = js.replace('function __initApp () {', 'function __initApp () {' + block, 1)
    open(gp, 'w', encoding='utf-8').write(js)
    print(f'  injected {len(names)} subpackage registration(s) into game.js')


def main() -> int:
    b = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BUILD
    if not os.path.isdir(b):
        print('[ERR] build dir not found:', b)
        return 1

    # 1. 分包目录与 assets/ 对齐：列表内 → subpackages/<name>/；列表外 → 移回 assets/<name>/
    subdir = os.path.join(b, SUBROOT)
    if os.path.isdir(subdir):
        for name in os.listdir(subdir):
            src = os.path.join(subdir, name)
            if not os.path.isdir(src) or name in SUBPACKAGES:
                continue
            dst = os.path.join(b, 'assets', name)
            if not os.path.isdir(dst):
                shutil.move(src, dst)
                print(f'  moved back {SUBROOT}/{name} -> assets/{name}')
    for name in SUBPACKAGES:
        src = os.path.join(b, 'assets', name)
        dst = os.path.join(b, SUBROOT, name)
        if os.path.isdir(src) and not os.path.isdir(dst):
            os.makedirs(os.path.join(b, SUBROOT), exist_ok=True)
            shutil.move(src, dst)
            print(f'  moved assets/{name} -> {SUBROOT}/{name}')

    # 2+3. game.json
    gp = os.path.join(b, 'game.json')
    j = json.load(open(gp))
    j['deviceOrientation'] = 'landscape'
    j['subpackages'] = [{'name': n, 'root': f'{SUBROOT}/{n}/'} for n in SUBPACKAGES]
    json.dump(j, open(gp, 'w'), indent=4)

    # 4. 分包占位 game.js
    for name in SUBPACKAGES:
        p = os.path.join(b, SUBROOT, name, 'game.js')
        if not os.path.exists(p):
            open(p, 'w').write(PLACEHOLDER)

    # 5. settings.json 引擎侧分包列表
    sp_path = os.path.join(b, 'src', 'settings.json')
    s = json.load(open(sp_path))
    s.setdefault('assets', {})['subpackages'] = list(SUBPACKAGES)
    json.dump(s, open(sp_path, 'w'), ensure_ascii=False, separators=(',', ':'))

    # 5. appid
    pc = os.path.join(b, 'project.config.json')
    c = json.load(open(pc))
    c['appid'] = APPID
    json.dump(c, open(pc, 'w'), indent=2, ensure_ascii=False)

    # 6. 分包 bundle 的 prerequisite-imports 注册注入主包（必须：微信不执行分包 JS，
    #    否则 loadBundle('bgm') 报 Unable to instantiate virtual:///prerequisite-imports/bgm）
    inject_subpackage_registrations(b, SUBPACKAGES)

    # 6.5 产物健康检查：早发现"构建出空包/分包缺音频"这类静默问题
    health_warn = check_build_health(b)
    if health_warn:
        for w in health_warn:
            print('[WARN] ' + w)

    # 尺寸核算（stat 实际字节；du 会因磁盘块虚高）
    def sz(root: str, skip=()) -> int:
        t = 0
        for r, _, fs in os.walk(root):
            for f in fs:
                p = os.path.join(r, f)
                if any(p.startswith(x) for x in skip):
                    continue
                t += os.path.getsize(p)
        return t

    skip = tuple(os.path.join(b, SUBROOT, n) for n in SUBPACKAGES)
    main_sz = sz(b, skip=skip)
    print(f'[OK] patched: {b}')
    print(f'  main: {main_sz / 1048576:.2f} MB (limit 4)')
    for n in SUBPACKAGES:
        v = sz(os.path.join(b, SUBROOT, n))
        print(f'  sub[{n}]: {v / 1048576:.2f} MB (limit 4)')
    if main_sz > 4 * 1048576:
        print('[WARN] 主包超 4MB！')
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
