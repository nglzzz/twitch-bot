#!/usr/bin/env python3
"""Собирает для OBS на Windows копию сцен с Linux: те же сцены, горячие клавиши, доки.

Берёт коллекцию сцен Linux-OBS, меняет пути /media/nglzzz/<диск>/ на буквы Windows,
подставляет устройства из Windows-коллекции (вебка, DroidCam, захват экрана, микрофоны)
и кладёт всё в obs/windows/out/. Ставит на Windows скрипт install.cmd.

    python3 obs/windows/build.py
"""
import copy
import json
import os
import re
import sys
import uuid
from configparser import ConfigParser
from pathlib import Path

HOME = Path.home()
LINUX = HOME / '.var/app/com.obsproject.Studio/config/obs-studio'
WINDOWS = Path('/media/nglzzz/windows/Users/nglzzz/AppData/Roaming/obs-studio')
OUT = Path(__file__).resolve().parent / 'out'
NAME = 'nglzzz-dvor'  # имя профиля и коллекции на Windows (латиницей: так проще скрипту установки)

# Диски Linux → буквы Windows (из реестра Windows, MountedDevices).
DRIVES = {'windows': 'C', 'projects': 'D', 'storage': 'E', 'hdd': 'F', 'games': 'G'}

# Источники, которые на Windows устроены иначе: имя на Linux → имя источника в Windows-коллекции.
DEVICES = {
    'webcam': 'webcam HD',
    'DroidCam': 'DroidCam OBS',
    'Основной экран': 'Main Display',
    'Browser': 'Browser',
    'Захват окна (Xcomposite)': 'Browser',
}
WEBCAM_RESOLUTION = '1920x1080'  # на Linux вебка 1080p — под неё рассчитаны обрезка и масштаб в сценах
# Петличка на Windows стояла в сценах с разговором — ставим в такие же.
LAV_MIC = 'Петличка'
LAV_MIC_SCENES = ['Main monitor', 'Большая вебка', 'Chat and Webcam', 'Старт', 'Конец стрима']
DEAD_DOCKS = ('goodgame.ru', 'wasd.tv', 'trovo.live', 'sc2tv.ru')

LINUX_ONLY_FILTERS = {'virtual_cam_filter', 'blur_filter'}


def win_path(text):
    def repl(m):
        return f"{m.group(1) or ''}{DRIVES[m.group(2)]}:/"
    return re.sub(r'(file:///)?/media/nglzzz/(' + '|'.join(DRIVES) + r')/', repl, text)


def walk(value):
    if isinstance(value, str):
        return win_path(value)
    if isinstance(value, list):
        return [walk(v) for v in value]
    if isinstance(value, dict):
        return {k: walk(v) for k, v in value.items()}
    return value


def missing_on_windows():
    """Фильтры и источники, которых нет в Windows-OBS (по последнему логу)."""
    logs = sorted((WINDOWS / 'logs').glob('*.txt'), key=os.path.getmtime)
    if not logs:
        return set()
    text = logs[-1].read_text(encoding='utf-8', errors='replace')
    return set(re.findall(r"Source ID '([^']+)' not found", text))


def device_from_windows(linux_src, win_src, missing):
    out = copy.deepcopy(win_src)
    out['name'] = linux_src['name']
    out['uuid'] = linux_src['uuid']
    out['filters'] = [f for f in out.get('filters', []) if f['id'] not in missing and not f['id'].startswith(('streamfx', 'obs-stream-effects'))]
    if linux_src['name'] == 'Захват окна (Xcomposite)':
        out['settings'] = {k: v for k, v in out['settings'].items() if k != 'window'}
    return out


def build_collection():
    linux = json.loads((LINUX / 'basic/scenes/nglzzztwitch.json').read_text(encoding='utf-8'))
    win = json.loads((WINDOWS / 'basic/scenes/nglzzz.json').read_text(encoding='utf-8'))
    win_src = {s['name']: s for s in win['sources']}
    missing = missing_on_windows() | LINUX_ONLY_FILTERS

    d = walk(linux)
    d['name'] = NAME
    sources = []
    for s in d['sources']:
        if s['name'] in DEVICES and s['id'] not in ('scene', 'group', 'browser_source'):
            s = device_from_windows(s, win_src[DEVICES[s['name']]], missing)
            if s['id'] == 'dshow_input':
                s['settings'].update(resolution=WEBCAM_RESOLUTION, last_resolution=WEBCAM_RESOLUTION, res_type=1)
        else:
            s['filters'] = [f for f in s.get('filters', []) if f['id'] not in missing]
        sources.append(s)
    d['sources'] = sources

    # Звук: устройства Windows вместо PulseAudio.
    for key in [k for k in d if re.match(r'(Desktop|Aux)AudioDevice\d', k)]:
        del d[key]
    for key in [k for k in win if re.match(r'(Desktop|Aux)AudioDevice\d', k)]:
        d[key] = copy.deepcopy(win[key])

    # Петличка — отдельный микрофон Windows, кладём в сцены с разговором.
    mic = copy.deepcopy(win_src[LAV_MIC])
    mic['filters'] = [f for f in mic.get('filters', []) if f['id'] not in missing]
    d['sources'].append(mic)
    by_name = {s['name']: s for s in d['sources']}
    for scene_name in LAV_MIC_SCENES:
        scene = by_name[scene_name]
        st = scene['settings']
        st['id_counter'] = (st.get('id_counter') or max([0] + [i['id'] for i in st['items']])) + 1
        item = copy.deepcopy(st['items'][0])
        item.update(name=LAV_MIC, source_uuid=mic['uuid'], id=st['id_counter'], visible=True, locked=True, group_item_backup=False)
        st['items'].insert(0, item)
        scene['hotkeys'][f"libobs.show_scene_item.{item['id']}"] = []
        scene['hotkeys'][f"libobs.hide_scene_item.{item['id']}"] = []

    leftovers = sorted({s['id'] for s in d['sources']} & {'v4l2_input', 'xshm_input', 'xcomposite_input', 'pulse_input_capture', 'pulse_output_capture'})
    if leftovers:
        sys.exit(f'Остались Linux-источники: {leftovers}')
    if '/media/nglzzz' in json.dumps(d, ensure_ascii=False):
        sys.exit('Остались Linux-пути')
    return d


def build_docks():
    def docks(path):
        ini = ConfigParser(interpolation=None, strict=False)
        ini.optionxform = str
        ini.read(path, encoding='utf-8-sig')
        return json.loads(ini.get('BasicWindow', 'ExtraBrowserDocks', fallback='[]'))

    have = docks(WINDOWS / 'user.ini')
    titles = {x['title'].lower() for x in have}
    urls = {x['url'] for x in have}
    add = []
    for dock in docks(LINUX / 'user.ini'):
        if dock['title'].lower() in titles or dock['url'] in urls or any(h in dock['url'] for h in DEAD_DOCKS):
            continue
        add.append({'title': dock['title'], 'url': dock['url'], 'uuid': uuid.uuid4().hex})
    return add


def main():
    OUT.mkdir(exist_ok=True)
    collection = build_collection()
    (OUT / f'{NAME}.json').write_text(json.dumps(collection, ensure_ascii=False, indent=4), encoding='utf-8')
    docks = build_docks()
    # По доку на строку, в том же виде, как пишет OBS. Скрипт установки дописывает их в user.ini как есть.
    lines = [json.dumps(d, ensure_ascii=False) for d in docks]
    if any('\\' in line for line in lines):
        sys.exit('Обратный слэш в доке — OBS экранирует его в ini по-своему')
    (OUT / 'docks.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Сцены: {", ".join(s["name"] for s in collection["scene_order"])}')
    print(f'Доки добавятся: {", ".join(d["title"] for d in docks) or "нет"}')
    print(f'Готово: {OUT}')


if __name__ == '__main__':
    main()
