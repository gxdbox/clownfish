#!/usr/bin/env python3
"""
gen_sprites.py — 批量生成《小丑鱼》AI 精灵素材（透明背景 RGBA PNG）

流程（fal.ai 已验证，见 skill references/fal-ai-image-gen.md）：
  1. fal-ai/flux/dev 文生图（square, output_format=png）
  2. fal-ai/birefnet/v2 抠透明（RGBA 真 alpha）
  3. 下载到 assets/resources/sprites/

用法：
  python3 tools/gen_sprites.py            # 生成全部素材
  python3 tools/gen_sprites.py --only enemy_jellyfish   # 只生成单个
依赖：pip install fal-client；FAL_KEY 从 game profile .env 读取
"""
import os
import sys
import json
import urllib.request
import shutil

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, 'assets', 'resources', 'sprites')

# 统一风格前缀：卡通 Q 版海洋生物，游戏素材，纯白背景（便于抠透明），无文字无阴影
STYLE = (
    "cute cartoon chibi style game asset, flat vector art, vibrant colors, "
    "clean thick dark outlines, full body centered, side view, "
    "isolated on solid white background, no shadow, no text, no watermark"
)

# 素材清单：name -> prompt（不含风格后缀）
ASSETS = [
    {
        "name": "enemy_jellyfish",
        "prompt": "a small pink translucent jellyfish with short tentacles, cute cartoon ocean monster, angry eyes",
    },
    {
        "name": "enemy_crab",
        "prompt": "a small red crab with big claws raised, cute cartoon ocean monster, angry eyes",
    },
    {
        "name": "enemy_eel",
        "prompt": "a small yellow electric eel with lightning sparks, cute cartoon ocean monster, angry eyes",
    },
    {
        "name": "enemy_puffer",
        "prompt": "a small spiky pufferfish puffed up with spikes, cute cartoon ocean monster, angry eyes",
    },
    {
        "name": "enemy_angler",
        "prompt": "a small dark anglerfish with a glowing lure on its head, cute cartoon ocean monster, big sharp teeth",
    },
    {
        "name": "player_clownfish",
        "prompt": "a cheerful orange clownfish with three white vertical stripes, cute cartoon hero character, big friendly eyes",
    },
    {
        "name": "boss_crab",
        "prompt": "a giant menacing king crab boss monster with huge spiked claws and crown, epic cartoon boss, dark red armor",
    },
    {
        "name": "boss_eel",
        "prompt": "a giant sea serpent electric eel boss monster with glowing blue fins and lightning, epic cartoon boss, coiled body",
    },
    {
        "name": "boss_angler",
        "prompt": "a giant abyssal anglerfish leviathan boss monster with a huge glowing lure and massive teeth, epic cartoon boss, deep sea horror",
    },
    {
        "name": "portal",
        "prompt": "a swirling glowing blue ocean vortex portal, magical spiral, cartoon game effect, no text",
    },
]


def load_fal_key() -> str:
    env_path = os.path.expanduser('~/.hermes/profiles/game/.env')
    if os.path.exists(env_path):
        for line in open(env_path, encoding='utf-8'):
            line = line.strip()
            if line.startswith('FAL_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('FAL_KEY', '')


def gen_image(client, prompt: str, size: str = 'square') -> str:
    """文生图，返回图片 URL"""
    r = client.subscribe('fal-ai/flux/dev', arguments={
        'prompt': prompt,
        'image_size': size,
        'output_format': 'png',
    })
    return r['images'][0]['url']


def cutout(client, url: str) -> str:
    """抠透明，返回 RGBA PNG URL"""
    r = client.subscribe('fal-ai/birefnet/v2', arguments={'image_url': url})
    return r['image']['url']


def download(url: str, path: str):
    req = urllib.request.Request(url, headers={'User-Agent': 'clownfish-gen/1.0'})
    with urllib.request.urlopen(req, timeout=120) as resp, open(path, 'wb') as f:
        shutil.copyfileobj(resp, f)


def main():
    key = load_fal_key()
    if not key:
        print('[ERROR] FAL_KEY 未找到（game profile .env）')
        sys.exit(1)
    os.environ['FAL_KEY'] = key
    import fal_client

    os.makedirs(OUT_DIR, exist_ok=True)
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]

    manifest = {}
    ok = 0
    fail = 0
    for spec in ASSETS:
        name = spec['name']
        if only and name != only:
            continue
        try:
            print(f'[gen] {name} ...')
            raw_url = gen_image(fal_client, spec['prompt'] + ', ' + STYLE)
            print(f'[cut] {name} ...')
            png_url = cutout(fal_client, raw_url)
            out = os.path.join(OUT_DIR, name + '.png')
            download(png_url, out)
            size = os.path.getsize(out)
            # 校验是 RGBA PNG
            with open(out, 'rb') as f:
                head = f.read(33)
            is_rgba = head[25] == 6  # PNG color type 6 = RGBA
            print(f'[ok ] {name}  {size // 1024}KB  rgba={is_rgba}')
            manifest[name] = {'file': f'{name}.png', 'bytes': size, 'rgba': is_rgba}
            ok += 1
        except Exception as e:
            print(f'[FAIL] {name}: {type(e).__name__} {str(e)[:200]}')
            fail += 1

    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f'\n[DONE] ok={ok} fail={fail}  ->  {OUT_DIR}')
    if fail:
        sys.exit(2)


if __name__ == '__main__':
    main()
