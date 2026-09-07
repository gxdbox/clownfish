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
6. project.config.json: appid（工具 leveldb 项目记录已同步修正，此处双保险）
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
