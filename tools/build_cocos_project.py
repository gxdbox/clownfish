#!/usr/bin/env python3
"""build_cocos_project.py — 从仓库源码+素材组装完整 Cocos Creator 3.8.8 工程（clownfish-cocos）

仓库（git 追踪，含 .meta 稳定 UUID，换机 pull 即可组装）：
  cocos-scripts/       脚本源码（含 .ts.meta，UUID 稳定，场景引用不断裂）
  assets/resources/    audio + sprites（含 .meta）
  assets/scenes/       main.scene（GameManager 已挂载到 Managers 节点）

组装 = 纯拷贝（保留 .meta）+ Cocos 空模板骨架，不再依赖任何外部项目。

用法：
  python3 tools/build_cocos_project.py [输出目录]
  默认输出：/Users/pony/Documents/game/clownfish-cocos
"""
import json
import os
import shutil
import sys
import uuid

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREATOR_TPL = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/templates/empty-2d'
DEFAULT_OUT = '/Users/pony/Documents/game/clownfish-cocos'


def new_uuid() -> str:
    return str(uuid.uuid4())


def write_meta(path: str, importer: str, u: str):
    """写 .meta 文件（目录用 importer=directory，脚本/场景/资源用各自 importer）"""
    meta = {
        'ver': '1.1.50',
        'importer': importer,
        'imported': True,
        'uuid': u,
        'files': [],
        'subMetas': {},
        'userData': {},
    }
    with open(path + '.meta', 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def copy_preserving_meta(src: str, dst: str):
    """拷贝 src 下所有文件（含 .meta）到 dst，保留相对结构"""
    for root, dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        dstdir = dst if rel == '.' else os.path.join(dst, rel)
        os.makedirs(dstdir, exist_ok=True)
        for f in files:
            shutil.copy2(os.path.join(root, f), os.path.join(dstdir, f))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT

    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)

    # ===== 工程骨架（Cocos 空模板） =====
    shutil.copy2(os.path.join(CREATOR_TPL, 'package.json'), os.path.join(out, 'package.json'))
    shutil.copy2(os.path.join(CREATOR_TPL, 'tsconfig.json'), os.path.join(out, 'tsconfig.json'))
    shutil.copytree(os.path.join(CREATOR_TPL, 'settings'), os.path.join(out, 'settings'))

    assets = os.path.join(out, 'assets')

    # ===== 拷贝脚本（含 .meta，UUID 稳定） =====
    copy_preserving_meta(os.path.join(REPO, 'cocos-scripts'), os.path.join(assets, 'scripts'))
    # ===== 拷贝资源（audio + sprites，含 .meta） =====
    copy_preserving_meta(os.path.join(REPO, 'assets', 'resources'), os.path.join(assets, 'resources'))
    # ===== 拷贝场景（GameManager 已挂载） =====
    copy_preserving_meta(os.path.join(REPO, 'assets', 'scenes'), os.path.join(assets, 'scenes'))

    # ===== 目录 .meta（顶层目录 UUID 无跨文件引用，可安全重新生成） =====
    write_meta(assets, 'directory', new_uuid())
    write_meta(os.path.join(assets, 'scripts'), 'directory', new_uuid())
    write_meta(os.path.join(assets, 'resources'), 'directory', new_uuid())
    write_meta(os.path.join(assets, 'scenes'), 'directory', new_uuid())

    n_scripts = sum(1 for _, _, fs in os.walk(os.path.join(assets, 'scripts')) for f in fs if f.endswith('.ts'))
    n_sprites = len([f for f in os.listdir(os.path.join(assets, 'resources', 'sprites')) if f.endswith('.png')])
    print('[OK] 工程已生成:', out)
    print('  脚本数:', n_scripts, '| 精灵图数:', n_sprites)
    print('  打开方式: Cocos Creator → 打开项目 →', out)


if __name__ == '__main__':
    main()
