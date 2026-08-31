#!/usr/bin/env python3
"""build_cocos_project.py — 一键生成可构建的 Cocos Creator 3.8.8 工程（clownfish-cocos）

用途：
  1. 本仓库 cocos-scripts/ 是纯脚本源码，本脚本把它 + 音频素材 + 最小场景组装成完整 Cocos 工程；
  2. 生成后可用 Cocos Creator 打开（或 headless 构建 wechatgame）做真实运行验证；
  3. 场景手术：以任意已有 2D 场景为基底（默认 dacaishang 的 main.scene），
     仅保留 Canvas + Camera，删除游戏节点，新增 Managers 节点挂 GameManager。

用法：
  python3 tools/build_cocos_project.py [输出目录] [基底场景路径]
  默认输出：/Users/pony/Documents/game/clownfish-cocos
"""
import json
import os
import re
import shutil
import sys
import uuid

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREATOR_TPL = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/templates/empty-2d'
DEFAULT_OUT = '/Users/pony/Documents/game/clownfish-cocos'
DEFAULT_BASE_SCENE = '/Users/pony/Documents/code/dacaishang/assets/scenes/main.scene'

B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'


def compress_uuid(u: str) -> str:
    """Cocos 压缩 uuid：前 5 位 hex 原样 + 剩余 27 位 hex 每 3 位编成 2 个 base64 字符"""
    h = u.replace('-', '')
    rest = h[5:]
    out = []
    for i in range(0, len(rest), 3):
        v = int(rest[i:i + 3], 16)
        out.append(B64[v >> 6])
        out.append(B64[v & 63])
    return h[:5] + ''.join(out)


def new_uuid() -> str:
    return str(uuid.uuid4())


def write_meta(path: str, importer: str, u: str, extra_user=None, files=None):
    meta = {
        'ver': '4.0.24' if importer == 'typescript' else ('1.1.50' if importer == 'scene' else '1.2.0'),
        'importer': importer,
        'imported': True,
        'uuid': u,
        'files': files or [],
        'subMetas': {},
        'userData': extra_user or {},
    }
    with open(path + '.meta', 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def copy_scripts(dst_scripts: str):
    """复制 cocos-scripts/**/*.ts 并生成 meta，返回 {相对路径: uuid}"""
    src = os.path.join(REPO, 'cocos-scripts')
    uuids = {}
    for root, _dirs, files in os.walk(src):
        for fn in files:
            if not fn.endswith('.ts'):
                continue
            rel = os.path.relpath(os.path.join(root, fn), src)
            dstdir = os.path.join(dst_scripts, os.path.dirname(rel))
            os.makedirs(dstdir, exist_ok=True)
            shutil.copy2(os.path.join(root, fn), os.path.join(dstdir, fn))
            u = new_uuid()
            write_meta(os.path.join(dstdir, fn), 'typescript', u)
            uuids[rel.replace(os.sep, '/')] = u
    # 目录 meta
    for root, dirs, _files in os.walk(dst_scripts):
        write_meta(root, 'directory', new_uuid())
    return uuids


def copy_audio(dst_audio: str):
    src = os.path.join(REPO, 'assets', 'resources', 'audio')
    os.makedirs(dst_audio, exist_ok=True)
    for fn in os.listdir(src):
        if fn.endswith('.m4a'):
            shutil.copy2(os.path.join(src, fn), os.path.join(dst_audio, fn))
            write_meta(os.path.join(dst_audio, fn), 'audio', new_uuid(),
                       extra_user={'downloadMode': 0})
    write_meta(dst_audio, 'directory', new_uuid())


def surgery_scene(base_scene: str, out_scene: str, gm_compressed: str):
    """保留 Canvas+Camera，删除其余游戏节点，Scene 根下新增 Managers 节点挂 GameManager"""
    d = json.load(open(base_scene, encoding='utf-8'))

    # 定位关键对象
    scene_idx = canvas_idx = camera_idx = None
    for i, o in enumerate(d):
        t = o.get('__type__')
        if t == 'cc.Scene':
            scene_idx = i
        elif t == 'cc.Node' and o.get('_name') == 'Canvas':
            canvas_idx = i
        elif t == 'cc.Node' and o.get('_name') == 'Camera':
            camera_idx = i
    assert scene_idx is not None and canvas_idx is not None and camera_idx is not None

    canvas = d[canvas_idx]
    camera = d[camera_idx]
    # 保留：SceneAsset(0)、Scene、Canvas、Camera、Canvas 的组件、Camera 的组件、SceneGlobals 等
    keep = {0, scene_idx, canvas_idx, camera_idx}
    keep.update(c['__id__'] for c in canvas.get('_components', []))
    keep.update(c['__id__'] for c in camera.get('_components', []))
    for i, o in enumerate(d):
        if o.get('__type__') in ('cc.SceneGlobals', 'cc.SceneInfo', 'cc.AmbientInfo', 'cc.ShadowsInfo',
                                 'cc.SkyboxInfo', 'cc.FogInfo', 'cc.OctreeInfo', 'cc.LightProbeInfo',
                                 'cc.PostSettingsInfo', 'cc.CameraInfo', 'cc.SkinInfo'):
            keep.add(i)

    # 旧→新 id 映射
    order = sorted(keep)
    old2new = {old: new for new, old in enumerate(order)}

    # 原地清理被删节点的引用（Canvas._children），避免 remap 悬空
    for i in keep:
        o = d[i]
        if o.get('__type__') == 'cc.Node':
            o['_children'] = [c for c in o.get('_children', []) if c['__id__'] in keep]

    def remap(v):
        if isinstance(v, dict):
            if set(v.keys()) == {'__id__'}:
                old = v['__id__']
                assert old in old2new, 'dangling ref %d' % old
                return {'__id__': old2new[old]}
            return {k: remap(x) for k, x in v.items()}
        if isinstance(v, list):
            return [remap(x) for x in v]
        return v

    nd = [remap(d[i]) for i in order]
    n = len(nd)
    managers_idx = n
    comp_idx = n + 1

    # Managers 节点（挂 Scene 根，bootstrap 会自动归位/补全其余结构）
    managers = {
        '__type__': 'cc.Node', '_name': 'Managers', '_objFlags': 0, '__editorExtras__': {},
        '_parent': {'__id__': old2new[scene_idx]}, '_children': [], '_active': True,
        '_components': [{'__id__': comp_idx}], '_prefab': None,
        '_lpos': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
        '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
        '_lscale': {'__type__': 'cc.Vec3', 'x': 1, 'y': 1, 'z': 1},
        '_mobility': 0, '_layer': 1073741824,
        '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
        '_id': 'clownfish-managers-0001',
    }
    gm_comp = {
        '__type__': gm_compressed, '_name': '', '_objFlags': 0,
        'node': {'__id__': managers_idx}, '_enabled': True, '__prefab': None,
    }
    nd.append(managers)
    nd.append(gm_comp)

    # Scene 与 Canvas 的 children 修正
    nd[old2new[scene_idx]]['_children'] = [remap(c) for c in d[scene_idx]['_children']
                                           if c['__id__'] in old2new] + [{'__id__': managers_idx}]
    nd[old2new[canvas_idx]]['_children'] = [remap(c) for c in d[canvas_idx]['_children']
                                            if c['__id__'] in old2new]

    with open(out_scene, 'w', encoding='utf-8') as f:
        json.dump(nd, f, ensure_ascii=False, indent=2)
    return old2new


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    base_scene = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_BASE_SCENE

    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)

    # 工程骨架
    with open(os.path.join(out, 'package.json'), 'w', encoding='utf-8') as f:
        json.dump({'name': 'clownfish', 'uuid': new_uuid(), 'creator': {'version': '3.8.8'}}, f, indent=2)
    shutil.copy2(os.path.join(CREATOR_TPL, 'tsconfig.json'), os.path.join(out, 'tsconfig.json'))
    shutil.copytree(os.path.join(CREATOR_TPL, 'settings'), os.path.join(out, 'settings'))

    # 脚本 + 音频
    assets = os.path.join(out, 'assets')
    uuids = copy_scripts(os.path.join(assets, 'scripts'))
    copy_audio(os.path.join(assets, 'resources', 'audio'))
    write_meta(os.path.join(assets, 'resources'), 'directory', new_uuid())
    write_meta(os.path.join(assets, 'scripts'), 'directory', new_uuid())
    write_meta(assets, 'directory', new_uuid())

    # 场景
    scenes = os.path.join(assets, 'scenes')
    os.makedirs(scenes)
    gm_rel = 'managers/GameManager.ts'
    assert gm_rel in uuids, 'GameManager.ts not found in cocos-scripts'
    gm_compressed = compress_uuid(uuids[gm_rel])
    surgery_scene(base_scene, os.path.join(scenes, 'main.scene'), gm_compressed)
    write_meta(os.path.join(scenes, 'main.scene'), 'scene', new_uuid(), files=['.json'])
    write_meta(scenes, 'directory', new_uuid())

    print('[OK] 工程已生成:', out)
    print('  GameManager uuid:', uuids[gm_rel], '→ 压缩:', gm_compressed)
    print('  脚本数:', len(uuids))


if __name__ == '__main__':
    main()
