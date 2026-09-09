# Промпты для генерации картинок «Мой класс»

Промпты написаны на английском — нейросети (Midjourney, SDXL, Flux, gpt-image, Kandinsky) понимают его заметно лучше.
Русские заголовки и пояснения — только для навигации.

**Как собирать промпт:** подставьте вместо `{STYLE}`, `{ИМЯ}` и `{NEG}` готовые блоки из этого файла. Блоки копируются **дословно, без пересказа своими словами** — именно дословность держит одно и то же лицо.

---

## 1. Технические требования игры

| Что | Файл | Размер |
|---|---|---|
| Аватарки | `photos/ava_<id>.png` | квадрат, ≥512×512 (генерьте 1024 и уменьшите) |
| Фото галереи | `photos/<id>.png` | квадрат, 800×800 (генерьте 1024 и уменьшите) |

- Формат **PNG**, имена файлов **не менять** — игра грузит их по точному пути.
- Аватарка в игре обрезается в **круг** (`object-fit: cover`) → лицо строго по центру кадра, ничего важного по углам.
- Генерируйте **1:1**. В Midjourney добавляйте `--ar 1:1`, в SD/Flux просто ставьте размер 1024×1024.

## 2. Как держать одно лицо (main best practices)

1. **Сначала аватарка, потом всё остальное.** Сгенерируйте аватар персонажа, отберите лучший дубль — он становится *референсом лица* для всех остальных картинок этого персонажа.
2. **«Паспорт» персонажа — неизменяемый текст.** Волосы, глаза, лицо, веснушки, очки формулируются всегда одними и теми же словами. Менялись одежда/фон/поза — меняйте только их. Любая перефразировка = новое лицо.
3. **Один стиль на всю игру.** Блок `{STYLE}` одинаков во всех промптах. Захотите другой стиль — поменяйте его один раз глобально, а не в отдельных картинках.
4. **Референсы лиц по генераторам:**
   - **Midjourney:** первая аватарка → дальше ко всем промптам персонажа `--cref <URL аватара> --cw 100`, для единого стиля `--sref <URL аватара> --sw 200`. Один и тот же `--seed` дополнительно стабилизирует, но лицо держит именно `--cref`.
   - **Stable Diffusion / SDXL:** IP-Adapter FaceID / InstantID / PhotoMaker с вашим референсом; золото-стандарт — натренировать маленькую **LoRA** на 15–25 картинках персонажа. Фиксируйте seed внутри одной серии.
   - **Flux:** PuLID-Flux с референсом.
   - **gpt-image (ChatGPT):** приложите аватар картинкой и просите «тот же человек, та же внешность».
   - **Кандминский / Шедеврум:** референсов нет — держит только дословный паспорт; генерьте по 4–8 вариантов и отбирайте.
5. **Не меняйте модель/версию посреди галереи** — сид и паспорт не переносятся между моделями.
6. **Негативный промпт** `{NEG}` — для SD-семейства и совместимых интерфейсов:
   > text, watermark, signature, logo, extra fingers, deformed hands, bad anatomy, asymmetrical eyes, cross-eyed, plastic skin, 3d render, doll-like, blurry, lowres, jpeg artifacts, oversaturated, harsh flash, extra people
7. **Никакого текста на картинке** (надписи, названия) — кириллицу модели ломают; игра подписи рисует сама.
8. Возраст в паспортах («17-year-old») нужен для правдоподобия. Если генератор вдруг отказывает — уберите возраст, оставьте «young high-school student»; все образы скромные, это проходит модерацию площадок.

## 3. Стиль

**`{STYLE}` (по умолчанию, для фото-кадров):**
```
beautiful stylized digital painting, semi-realistic anime-influenced style, clean detailed rendering, soft warm cinematic lighting, vibrant natural colors, sharp focus, high quality
```

**`{STYLE_WC}` — только для нарисованных Катей кадров (`k_ph5`):**
```
hand-painted watercolor illustration on textured paper, soft washes, visible brush strokes, loose sketchy pencil underdrawing, delicate colors
```

**`{STYLE_PENCIL}` — только `k_ph7`:**
```
expressive graphite pencil sketch on sketchbook paper, light cross-hatching, a few eraser marks, monochrome, hand-drawn feel
```

**`{STYLE_OLD}` — только `a_ph5` (старое детское фото):**
```
slightly faded old film photograph, warm faded colors, gentle vignette, subtle film grain, early-2010s snapshot look
```

---

## 4. Паспорта персонажей

> Паспорт — абзац в кавычках. Копируйте его в каждый промпт этого персонажа слово в слово.
> Одежду в паспорте при необходимости заменяйте описанием костюма из промпта кадра (пляж/зима/ночь) — лицо, волосы, очки и приметы не трогать никогда.

### Катя — `ava_katya.png` · `{KATYA}`
Тихая художница; тёплые тона, круглые очки.
```
Katya, a 17-year-old Russian schoolgirl with a soft round face, long wavy chestnut-brown hair parted in the middle, big round thin brown-framed glasses, warm hazel eyes, fair skin with faint freckles across her nose, gentle shy smile, wearing a cozy teal-green knitted sweater
```
Аватар: `{STYLE}, {KATYA}, head-and-shoulders portrait facing the viewer, simple softly blurred warm background, centered composition, face fully visible, high detail --ar 1:1`

### Света — `ava_sveta.png` · `{SVETA}`
Спортсменка, дерзкая; высокий хвост.
```
Sveta, a 17-year-old Russian schoolgirl with an athletic fit build, golden-blonde hair pulled into a high ponytail with a coral-red scrunchie, bright blue eyes, lightly tanned skin, confident cheeky grin, small silver stud earrings, wearing a coral-red sporty jacket over a white t-shirt
```
Аватар: `{STYLE}, {SVETA}, head-and-shoulders portrait facing the viewer, simple softly blurred warm background, centered composition, face fully visible, high detail --ar 1:1`

### Аня — `ava_anya.png` · `{ANYA}`
Романтичная подруга детства; косичка, осенние тона.
```
Anya, a 17-year-old Russian schoolgirl with a warm heart-shaped face and light freckles, auburn red-brown hair in a long side braid over her shoulder with a small pink flower hairpin, soft amber-brown eyes, fair skin, gentle dreamy smile, wearing a cream-beige knitted cardigan
```
Аватар: `{STYLE}, {ANYA}, head-and-shoulders portrait facing the viewer, simple softly blurred warm background, centered composition, face fully visible, high detail --ar 1:1`

### Вика — `ava_vika.png` · `{VIKA}`
Соседка-гитаристка; тёмные волосы с фиолетовой прядью.
```
Vika, a 17-year-old Russian schoolgirl, pale skin, jet-black shoulder-length hair with one vivid purple streak framing her face, gray-green eyes with subtle dark eyeliner, sly confident smirk, small silver piercings in her ears, black chunky headphones around her neck, wearing a dark charcoal t-shirt
```
Аватар: `{STYLE}, {VIKA}, head-and-shoulders portrait facing the viewer, simple softly blurred cool-toned background, centered composition, face fully visible, high detail --ar 1:1`
Её кот (встречается в кадрах): `Barsik, a fluffy gray-and-white house cat with green eyes`

### Дима — `ava_dima.png` · `{DIMA}`
Лучший друг; кепка и широкая улыбка.
```
Dima, a 17-year-old Russian schoolboy with short tousled brown hair, wide friendly grin, warm brown eyes, lightly tanned skin, wearing a blue baseball cap turned backwards and a plain blue t-shirt
```
Аватар: `{STYLE}, {DIMA}, head-and-shoulders portrait facing the viewer, simple softly blurred cool-toned background, centered composition, face fully visible, high detail --ar 1:1`

### Мама — `ava_mama.png` · `{MAMA}`
```
Mama, a kind Russian woman in her mid-forties, light-brown hair pinned into a soft low bun, warm brown eyes, gentle smile with soft laugh lines, fair skin, wearing a rose-pink blouse
```
Аватар: `{STYLE}, {MAMA}, head-and-shoulders portrait facing the viewer, simple softly blurred cozy home background, centered composition, face fully visible, high detail --ar 1:1`

### Алиса — `ava_alisa.png` · `{ALISA}`
Голосовой ассистент телефона — не человек, абстрактный знак (лицо не нужно и консистентность держится сама).
```
a minimal futuristic AI assistant avatar: a glossy sphere of blue-violet gradient glass with a soft glowing sound-wave ripple inside, subtle friendly light arcs, floating holographic sparkles, dark navy background, clean polished 3D icon look
```
Аватар: `{STYLE}, {ALISA}, centered composition, circular icon-friendly framing --ar 1:1`

### Ольга Николаевна — `ava_teach.png` · `{TEACH}`
Классный руководитель.
```
Olga Nikolaevna, a Russian schoolteacher in her early fifties, short ash-brown hair with neat grey streaks, rectangular dark-framed glasses, gray-green eyes, composed strict-but-kind expression, wearing a dark-green formal blouse
```
Аватар: `{STYLE}, {TEACH}, head-and-shoulders portrait facing the viewer, simple softly blurred neutral background, centered composition, face fully visible, high detail --ar 1:1`

### Елизавета Андреевна — `ava_young.png` · `{YOUNG}`
Молодая учительница литературы; элегантная, сдержанная.
```
Elizaveta Andreevna, an elegant Russian literature teacher in her late twenties, long dark plum-brown hair loosely pinned up with a few free strands, thin silver-rimmed glasses, calm intelligent grey-violet eyes, soft enigmatic half-smile, fair skin, wearing a lavender-violet blouse with a high collar
```
Аватар: `{STYLE}, {YOUNG}, head-and-shoulders portrait facing the viewer, simple softly muted background, centered composition, face fully visible, high detail --ar 1:1`

### Герой (ты) · `{HERO}`
Появляется только в «парных» кадрах — лицо тоже должно быть одним и тем же.
```
Artyom, a 17-year-old Russian schoolboy with short dark-chestnut hair, kind brown eyes, lightly tanned skin, open friendly smile, wearing a plain blue t-shirt under an open light-denim shirt
```
*Примечание: в игре герой безымянный («ты»); имя Артём использовано только в промптах.*

### Общий чат — аватарка не нужна
Чат `group` показывает эмодзи 💔. Если захотите картинку — просто положите `photos/ava_group.png` (квадрат), игра подхватит её автоматически.

### Взрослые версии — серия «Спустя 10 лет» · `{KATYA_AD}` / `{SVETA_AD}` / `{ANYA_AD}` / `{VIKA_AD}`
Premium-фотосеты магазина — отдельная временная линия «встреча выпускников через десять лет»: героиням ~27 лет, школьного контекста нет. Лицо, волосы, глаза и приметы — **те же дескрипторы, что в основных паспортах** (слово в слово), меняются только возраст, причёска-укладка по кадру и одежда. Герой в серии не появляется. Эти паспорта тоже копировать дословно.

```
{KATYA_AD} = Katya, a 27-year-old Russian woman with a soft round face, long wavy chestnut-brown hair parted in the middle, big round thin brown-framed glasses, warm hazel eyes, fair skin with faint freckles across her nose, gentle confident smile
```
```
{SVETA_AD} = Sveta, a 27-year-old Russian woman with an athletic fit build, golden-blonde hair pulled into a high ponytail with a coral-red scrunchie, bright blue eyes, lightly tanned skin, confident cheeky grin, small silver stud earrings
```
```
{ANYA_AD} = Anya, a 27-year-old Russian woman with a warm heart-shaped face and light freckles, auburn red-brown hair in a long side braid over her shoulder with a small pink flower hairpin, soft amber-brown eyes, fair skin, gentle dreamy smile
```
```
{VIKA_AD} = Vika, a 27-year-old Russian woman, pale skin, jet-black shoulder-length hair with one vivid purple streak framing her face, gray-green eyes with subtle dark eyeliner, sly confident smirk, small silver piercings in her ears
```
Тон серии: лёгкий флирт и намёк, ничего откровенного — формулировки ниже подобраны так, чтобы проходить модерацию генераторов и площадок. Если генератор отказывает — смягчайте сцену, а не паспорт.

---

## 5. Галерея — промпт на каждый кадр

### Катя
**`k_ph1.png` — «закат с нашего двора»** · селфи с мольбертом
```
{STYLE}, {KATYA}, casual front-camera selfie at arm's length, golden sunset in the courtyard behind her, a wooden easel with a half-finished watercolor of a sunset, warm evening light, cozy mood --ar 1:1
```

**`k_ph2.png` — «моя первая выставка»**
```
{STYLE}, {KATYA}, standing by an exhibition wall hung with her own framed watercolor paintings, happily embarrassed expression, hands clasped, soft gallery lighting, visitors blurred far in the background --ar 1:1
```

**`k_ph3.png` — «пикник у реки»**
```
{STYLE}, {KATYA}, sitting on a picnic blanket by a river, wicker basket and sandwiches nearby, bright summer sunshine, waving cheerfully at the camera, candid snapshot framing --ar 1:1
```

**`k_ph4.png` — «мы ❤»** · парное
```
{STYLE}, {KATYA} and {HERO} together on an old bridge at sunset, both laughing warmly, candid couple photo taken at arm's length, golden hour backlight, river below --ar 1:1
```

**`k_ph5.png` — «набросок в столовой»** · это её акварель, не фото
```
{STYLE_WC}, a watercolor portrait of {HERO} sitting gloomy over a food tray in a school cafeteria, humorous tired expression, watercolor style only, no photograph
```

**`k_ph6.png` — «моя стена на выставке»**
```
{STYLE}, {KATYA}, proud and slightly nervous, standing beside her own wall of framed watercolors at a city exhibition, name tags under the paintings, soft indoor lighting --ar 1:1
```

**`k_ph7.png` — «набросок героя»** · карандашный набросок
```
{STYLE_PENCIL}, a pencil sketch portrait of {HERO}, lively and slightly embarrassed expression, three-quarter view, sketch in a sketchbook, hand-drawn style only, no photograph
```

**`k_sum.png` — фотосет «Лето»**
```
{STYLE}, {KATYA} at the seaside in a light modest summer dress instead of her sweater, sunglasses pushed up on her head, sea and soft waves behind, gentle breeze, warm daylight --ar 1:1
```

**`k_night.png` — фотосет «Ночь»**
```
{STYLE}, {KATYA} at night against blurred city lights, holding a sketch tablet under her arm, bokeh lanterns, cool night palette with warm accents --ar 1:1
```

**`k_win.png` — фотосет «Зима»**
```
{STYLE}, {KATYA} in a cozy winter coat and mittens holding a cup of cocoa, light frost on her cheeks, falling snow, soft winter daylight --ar 1:1
```

### Света
**`s_ph1.png` — «после тренировки»**
```
{STYLE}, {SVETA}, resting after volleyball practice in a school gym, pull-up bars and a volleyball net behind her, sporty confident pose, towel over one shoulder --ar 1:1
```

**`s_ph2.png` — «золото! смотрели?»**
```
{STYLE}, {SVETA}, holding a golden trophy on the winners' podium of city sports competitions, triumphant beaming smile, medals ceremony, festive banners blurred behind --ar 1:1
```

**`s_ph3.png` — «рассвет над новым городом»**
```
{STYLE}, {SVETA} jogging through a city street at sunrise, pink-gold dawn light, long shadows, athletic wear, motion and morning freshness --ar 1:1
```

**`s_ph4.png` — «каток с лучшим 💙»** · парное
```
{STYLE}, {SVETA} and {HERO} together at an outdoor ice rink in a park, both in skates, breath visible in frosty air, warm mittens, evening rink lights, joyful candid photo --ar 1:1
```

**`s_ph5.png` — «золото и мы»**
```
{STYLE}, {SVETA}, close-up on the winners' podium after a 3:1 victory final, gold medal around her neck, radiant champion smile, stadium lights bokeh behind --ar 1:1
```

**`s_sum.png` — фотосет «Лето»**
```
{STYLE}, {SVETA} at the beach holding a volleyball, wearing a white panama hat and a light modest summer sports outfit, playful grin, sea and sand behind --ar 1:1
```

**`s_night.png` — фотосет «Ночь»**
```
{STYLE}, {SVETA} after an evening match, gold medal on her jacket, night stadium floodlights glowing behind her, proud happy look --ar 1:1
```

**`s_win.png` — фотосет «Зима»**
```
{STYLE}, {SVETA} on a snowy stadium after a winter run, breath steaming in cold air, athletic winter gear, snow-covered bleachers, crisp morning light --ar 1:1
```

### Аня
**`a_ph1.png` — «наш парк осенью»**
```
{STYLE}, {ANYA} in an autumn park by an old wooden bench, golden fallen leaves everywhere, soft overcast autumn light, nostalgic cozy mood --ar 1:1
```

**`a_ph2.png` — «звездопад, помнишь?»**
```
{STYLE}, {ANYA} sitting on a rooftop at night under a plaid blanket with a thermos of tea, starry sky with shooting meteors above, warm string lights, dreamy atmosphere --ar 1:1
```

**`a_ph3.png` — «дождь + стихи»**
```
{STYLE}, {ANYA} reading a poetry book by a window, raindrops running down the glass, soft lamp light, cozy melancholic evening mood --ar 1:1
```

**`a_ph4.png` — «зонт на двоих ☔»** · парное
```
{STYLE}, {ANYA} and {HERO} under one umbrella during the first autumn rain, wet leaves on the pavement, warm street lamp glow, close candid couple photo --ar 1:1
```

**`a_ph5.png` — «старое фото»** · детское фото
```
{STYLE_OLD}, an old childhood photo of {ANYA} and {HERO} as two kids about ten years old climbing a tree after a stuck kite, autumn yard, same faces recognizable, faded snapshot look
```

**`a_ph6.png` — «качели — официально наши»** · парное
```
{STYLE}, {ANYA} and {HERO} sitting together on swings in an autumn courtyard at sunset, gentle motion blur on the swings, golden leaves falling, warm happy mood --ar 1:1
```

**`a_sum.png` — фотосет «Лето»**
```
{STYLE}, {ANYA} on a sunset seashore in a light modest sundress instead of her cardigan, wind in her loose hair (no braid — hair down but same color), warm golden sea behind --ar 1:1
```
*Тут косичка распущена по сюжету кадра — цвет и лицо не менять.*

**`a_night.png` — фотосет «Ночь»**
```
{STYLE}, {ANYA} on a night street wrapped in a warm scarf, glowing street lanterns and city bokeh behind, soft smile, cozy night palette --ar 1:1
```

**`a_win.png` — фотосет «Зима»**
```
{STYLE}, {ANYA} catching the first snowflakes with her palms, delighted wondering face, first snow falling, soft grey-blue winter light --ar 1:1
```

### Вика
**`v_ph1.png` — «мы с Барсиком»**
```
{STYLE}, {VIKA} sitting with a fluffy gray-and-white cat on her lap, big black headphones resting around her neck, cozy dim room with a computer glow behind, relaxed smirk --ar 1:1
```

**`v_ph2.png` — «репетиция громче всех»**
```
{STYLE}, {VIKA} playing an electric guitar in a garage during a band rehearsal, amps and cables around, energetic rock mood, warm garage lamp light --ar 1:1
```

**`v_ph3.png` — «крыша поёт 🌙»**
```
{STYLE}, {VIKA} playing an acoustic guitar sitting on a rooftop ledge, evening city glowing far below, dusk sky with first stars, string lights nearby --ar 1:1
```

**`v_ph4.png` — «наша крыша ❤»** · парное
```
{STYLE}, {VIKA} and {HERO} together on their rooftop at night, acoustic guitar leaning nearby, warm fairy lights strung above, city lights below, cozy candid couple photo --ar 1:1
```

**`v_ph5.png` — «дубль один и пожизненный»**
```
{STYLE}, {VIKA} in a recording studio booth, big professional headphones, studio microphone in front, guitar on her lap, focused look right before the first take, moody studio lighting --ar 1:1
```

**`v_sum.png` — фотосет «Лето»**
```
{STYLE}, {VIKA} playing an acoustic guitar right on the beach sand, modest summer clothes instead of her usual outfit (same hair and headphones), blurred friends around a small beach bonfire, sunset sea --ar 1:1
```

   **`v_night.png` — фотосет «Ночь»**
```
{STYLE}, {VIKA} against glowing night city lights with a fluffy gray-and-white cat perched on her shoulder, playful smirk, bokeh city background --ar 1:1
```

**`v_win.png` — фотосет «Зима»**
```
{STYLE}, {VIKA} in a warm winter jacket building a snowman with a fluffy gray-and-white cat watching nearby, snowy courtyard, playful winter mood --ar 1:1
```

### Мама
**`m_ph1.png` — «мамин пирог»**
```
{STYLE}, {MAMA} in a cozy home kitchen holding a freshly baked apple pie, warm oven light, tea cups on the table, homely happy mood --ar 1:1
```

**`m_ph2.png` — «блинный переполох»**
```
{STYLE}, {MAMA} in the kitchen with a tall stack of blini (Russian crepes), light flour dust in the air, laughing warmly, cozy morning light --ar 1:1
```

### Дима
**`d_ph1.png` — «мы на рыбалке»**
```
{STYLE}, {DIMA} holding a fishing rod by a calm lake at midday, proud funny smile showing off a small fish in a bucket, green forest across the water, casual buddy snapshot --ar 1:1
```

### Елизавета Андреевна
**`y_ph1.png` — «обложка "Чистовика"»**
```
{STYLE}, {YOUNG} at a neat teacher's desk with a stack of handwritten manuscripts, holding up a modest green-covered literary almanac booklet (no readable text on it), soft window light, quiet pride --ar 1:1
```

**`y_ph2.png` — «со сцены видно всё»**
```
{STYLE}, {YOUNG} on a school stage during a literature evening, holding the almanac booklet, applause of a blurred audience in the auditorium, warm stage light, slight happy smile --ar 1:1
```

**`y_ph3.png` — «просто Лиза»**
```
{STYLE}, {YOUNG} in a small café near a railway station, warm lamp light, a cup of coffee on the table, relaxed light smile without her usual reserve, trains faintly visible through the window behind --ar 1:1
```
*Единственный кадр, где она без очков допустима по сюжету «просто Лиза» — но лицо и причёску не менять.*

---

## 5б. Premium-серия «Спустя 10 лет» — 40 кадров

Все кадры — `{STYLE}` + взрослый паспорт + сцена, `--ar 1:1`, размер 1024→800. Лица — через референс аватарки той же героини. Возраст в каждом промпте зашит в паспорт (`27-year-old woman`), сцены — только «после школы»: путешествия, сауна, пляж, отпуск. Школьная форма/школьные локации в серии запрещены.

### Пак «Выпускной: 10 лет» (`reu`)
**`k_reu.png`** — `{KATYA_AD}` в изумрудном вечернем платье
```
{STYLE}, {KATYA_AD}, at an evening class-reunion banquet ten years after graduation, elegant emerald-green evening dress, holding a glass of champagne, warm string lights and festive garlands behind, soft happy smile --ar 1:1
```
**`s_reu.png`** — `{SVETA_AD}`
```
{STYLE}, {SVETA_AD}, at an evening class-reunion banquet, elegant scarlet evening dress, athletic posture, raising her glass with a victorious laugh, festive banquet hall bokeh behind --ar 1:1
```
**`a_reu.png`** — `{ANYA_AD}`
```
{STYLE}, {ANYA_AD}, at an evening class-reunion banquet, elegant lavender evening dress, holding her first published book manuscript, dreamy proud smile, warm candlelight --ar 1:1
```
**`v_reu.png`** — `{VIKA_AD}`
```
{STYLE}, {VIKA_AD}, at an evening class-reunion banquet, little black evening dress, acoustic guitar leaning against her chair, sly confident smirk, warm string lights --ar 1:1
```

### Пак «Пляж: 10 лет» (`bch`)
**`k_bch.png`**
```
{STYLE}, {KATYA_AD}, on a sunny seaside beach, elegant modest one-piece swimsuit with a light sarong tied at the waist, straw hat in her hand, sea spray and bright daylight, joyful smile --ar 1:1
```
**`s_bch.png`**
```
{STYLE}, {SVETA_AD}, on a sunny beach, sporty modest one-piece swimsuit, holding a volleyball, confident coach-like grin, sea and gentle waves behind --ar 1:1
```
**`a_bch.png`**
```
{STYLE}, {ANYA_AD}, sitting on sunset sand in a modest one-piece swimsuit and a lacy beach cover-up, collecting seashells in her palms, warm golden-hour light, calm dreamy mood --ar 1:1
```
**`v_bch.png`**
```
{STYLE}, {VIKA_AD}, on a beach at sunset, modest one-piece swimsuit with denim shorts, playing an acoustic guitar, small beach bonfire bokeh far behind, relaxed smirk --ar 1:1
```

### Пак «Сауна: 10 лет» (`sau`)
Важно: полотенце закрывает фигуру от плеч до колен, пар прикрывает фон — никаких откровенных поз.
**`k_sau.png`**
```
{STYLE}, {KATYA_AD}, relaxing in a wooden sauna, softly wrapped in a white terry bath towel from shoulders to knees, light steam in the air, birch branches and a wooden bucket nearby, peaceful content expression --ar 1:1
```
**`s_sau.png`**
```
{STYLE}, {SVETA_AD}, in a wooden sauna, wrapped in a white terry towel shoulders-to-knees, playful squint through wisps of steam, ladle resting on the bench, warm wood tones --ar 1:1
```
**`a_sau.png`**
```
{STYLE}, {ANYA_AD}, in a wooden sauna wrapped in a white towel with a plaid blanket over her shoulders, holding a mug of herbal tea, cozy steam, dreamy relaxed smile --ar 1:1
```
**`v_sau.png`**
```
{STYLE}, {VIKA_AD}, in a wooden sauna, white towel wrapped shoulders-to-knees, damp purple streak in her hair, steam swirling, sly teasing smirk --ar 1:1
```

### Пак «Утро в отеле» (`htl`)
**`k_htl.png`**
```
{STYLE}, {KATYA_AD}, a cozy hotel bathroom morning, soft white bath towel wrapped around her, damp wavy hair, candles on the bathtub edge with foam, blissful relaxed smile --ar 1:1
```
**`s_htl.png`**
```
{STYLE}, {SVETA_AD}, hotel morning, white bath towel around her shoulders, holding a cup of coffee by a fogged mirror, energetic start-of-the-day smile --ar 1:1
```
**`a_htl.png`**
```
{STYLE}, {ANYA_AD}, a warm hotel bathroom, wrapped in a soft towel and seated beside a steaming bathtub with candles, reading a poetry book, dreamy candlelit mood --ar 1:1
```
**`v_htl.png`**
```
{STYLE}, {VIKA_AD}, a hotel bathroom, white towel wrapped like a turban on her head, singing into a hairbrush with a cheeky grin, light steam behind the shower curtain --ar 1:1
```

### Пак «Ветер у моря» (`wnd`)
Платья в кадрах — до колена и ниже; ветер лишь играет тканью.
**`k_wnd.png`**
```
{STYLE}, {KATYA_AD}, on a seaside promenade, a knee-length light summer dress fluttering in the sea wind, chasing her straw hat flying away, laughing, elegant motion --ar 1:1
```
**`s_wnd.png`**
```
{STYLE}, {SVETA_AD}, on a wooden pier, knee-length sundress and wind-blown high ponytail, white sailboat behind, confident joyful look --ar 1:1
```
**`a_wnd.png`**
```
{STYLE}, {ANYA_AD}, on grassy dunes, a long ankle-length skirt playing in the wind, loose strands of hair across her face, dry grass flying, dreamy romantic mood --ar 1:1
```
**`v_wnd.png`**
```
{STYLE}, {VIKA_AD}, on a cliff above the sea, knee-length dress swirling in the wind, acoustic guitar in her hands, purple streak flying, playful smirk --ar 1:1
```

### Пак «Загородный уикенд» (`dch`)
**`k_dch.png`**
```
{STYLE}, {KATYA_AD}, at a country-house garden, light summer sundress, sketching on a small easel under an apple tree, a jug of lemonade on a lounger, lazy sunny morning --ar 1:1
```
**`s_dch.png`**
```
{STYLE}, {SVETA_AD}, at a country garden, light sundress, lying in a hammock between birch trees, laughing, dappled sunlight --ar 1:1
```
**`a_dch.png`**
```
{STYLE}, {ANYA_AD}, at a country garden in a light sundress, writing in a notebook on a plaid blanket in apple-tree shade, warm noon light, peaceful mood --ar 1:1
```
**`v_dch.png`**
```
{STYLE}, {VIKA_AD}, at a country yard at sunset, sundress over a t-shirt, playing acoustic guitar, a plaid on the wooden fence behind, warm evening glow --ar 1:1
```

### Пак «Бассейн» (`poo`)
**`k_poo.png`**
```
{STYLE}, {KATYA_AD}, at an indoor swimming pool, modest one-piece swimsuit, swim goggles pushed up on her forehead, sitting at the lane edge with splashes, proud cheerful smile --ar 1:1
```
**`s_poo.png`**
```
{STYLE}, {SVETA_AD}, at a swimming pool in a sporty one-piece swimsuit, crouched in a starting position on the block, morning light through tall windows, focused grin --ar 1:1
```
**`a_poo.png`**
```
{STYLE}, {ANYA_AD}, sitting on the edge of a swimming pool, modest one-piece swimsuit, feet in the water, soft steam over blue lanes, calm dreamy smile --ar 1:1
```
**`v_poo.png`**
```
{STYLE}, {VIKA_AD}, floating on her back in a pool in a modest one-piece swimsuit, big black headphones on, playful splash fan, relaxed smirk --ar 1:1
```

### Пак «Круиз» (`crs`)
**`k_crs.png`**
```
{STYLE}, {KATYA_AD}, on a cruise ship deck at sunset, light flowing dress, painting at a small easel, ribboned straw hat, golden sea horizon --ar 1:1
```
**`s_crs.png`**
```
{STYLE}, {SVETA_AD}, on a cruise ship bridge, linen dress, one hand on the ship wheel, morning sun over open sea, bright confident smile --ar 1:1
```
**`a_crs.png`**
```
{STYLE}, {ANYA_AD}, at the stern of a cruise ship, a long floor-length dress waving in the wind, sunset over open water, gentle thoughtful smile --ar 1:1
```
**`v_crs.png`**
```
{STYLE}, {VIKA_AD}, on a cruise ship deck in the evening, dress and sneakers, playing guitar by fairy lights near the ship pool, cozy night mood --ar 1:1
```

### Пак «Коктейли на крыше» (`bar`)
**`k_bar.png`**
```
{STYLE}, {KATYA_AD}, at a rooftop bar at night, elegant black evening dress, holding a cocktail glass, city lights bokeh below, soft laugh --ar 1:1
```
**`s_bar.png`**
```
{STYLE}, {SVETA_AD}, at a rooftop bar, elegant evening dress, raising her glass in a toast, panoramic night city behind, confident happy grin --ar 1:1
```
**`a_bar.png`**
```
{STYLE}, {ANYA_AD}, at a rooftop lounge in a silk evening dress, curled in an armchair with verses in a notebook, string lights and lanterns, cozy dreamy mood --ar 1:1
```
**`v_bar.png`**
```
{STYLE}, {VIKA_AD}, at a rooftop jazz bar, elegant dark evening outfit, purple streak catching the light, a saxophonist blurred in the background, sly smile --ar 1:1
```

### Пак «Пикник на закате» (`pic`)
**`k_pic.png`**
```
{STYLE}, {KATYA_AD}, on a lakeside picnic at golden hour, light sundress, painting small watercolor studies on a plaid blanket, wicker basket nearby, warm last sunlight --ar 1:1
```
**`s_pic.png`**
```
{STYLE}, {SVETA_AD}, at a lakeside picnic, sundress and sneakers, holding a badminton racket mid-laugh, long evening shadows, sporty joyful mood --ar 1:1
```
**`a_pic.png`**
```
{STYLE}, {ANYA_AD}, in a meadow by a lake at sunset, light sundress, reading aloud from a book, tall grass glowing golden, serene warm mood --ar 1:1
```
**`v_pic.png`**
```
{STYLE}, {VIKA_AD}, at a lakeside picnic at dusk, sundress, acoustic guitar on her knees, a slice of watermelon in hand, warm carefree smile --ar 1:1
```

---

## 5в. Premium-серия «Елизавета Андреевна: приватные фотосеты» — 30 кадров

Отдельная серия для взрослой героини (учительнице ~27 лет, «late twenties» уже зашито в паспорт `{YOUNG}`). Школьного контекста нет. Лицо, волосы, очки — те же дескрипторы из паспорта `{YOUNG}` слово в слово; **причёску можно распускать/собирать по кадру, но цвет и лицо не менять**. Тон серии — лёгкий флирт и намёк, ничего откровенного: купальники скромные, полотенце закрывает фигуру от плеч до колен, пар/пена/свет закрывают фон. Если генератор отказывает — смягчайте сцену, а не паспорт.

### Пак «Лазурный берег» (`lashore`)
**`y_be1.png`**
```
{STYLE}, {YOUNG}, standing at the edge of the sea on a sunny southern beach, elegant modest one-piece swimsuit, wide straw hat in her hand, loose dark plum-brown hair in the breeze, bright daylight and turquoise water, calm confident smile --ar 1:1
```
**`y_be2.png`**
```
{STYLE}, {YOUNG}, sitting on a beach towel at sunset, modest swimsuit with a light sarong around her waist, reading a small poetry book, golden-hour light on her face, serene adult mood --ar 1:1
```
**`y_be3.png`**
```
{STYLE}, {YOUNG}, walking along the water line at sunset, modest one-piece swimsuit, loose hair and a light pareo fluttering in the wind, gentle waves around her ankles, relaxed half-smile --ar 1:1
```

### Пак «Пена и шёлк» (`labath`)
Важно: пена и полотенце закрывают всё, что нужно, без откровенности.
**`y_ba1.png`**
```
{STYLE}, {YOUNG}, relaxing in a bathtub covered up to the shoulders with thick white foam, bath towel wrapped like a turban on her head, candles glowing on the edge of the tub, eyes closed, blissful peaceful expression --ar 1:1
```
**`y_ba2.png`**
```
{STYLE}, {YOUNG}, in a bright hotel bathroom, wrapped in a white terry towel from shoulders to knees, holding a cup of morning coffee, damp hair, soft window light and steam, cozy adult morning mood --ar 1:1
```
**`y_ba3.png`**
```
{STYLE}, {YOUNG}, seated at the edge of a bathtub with foam, white towel wrapped around her body, holding an open book just above the foam line, candlelight, dreamy focused expression --ar 1:1
```

### Пак «После душа» (`ladew`)
**`y_sh1.png`**
```
{STYLE}, {YOUNG}, right after a shower in a tiled bathroom, wrapped in a white towel shoulders-to-knees, another towel drying her loose damp hair, light steam around, wet strands on her cheek, soft smile --ar 1:1
```
**`y_sh2.png`**
```
{STYLE}, {YOUNG}, in a steamy bathroom, soft white towel wrapped around her, loose wet dark plum-brown hair over her shoulder, one hand holding a silky robe, steam and warm light, intimate relaxed mood --ar 1:1
```
**`y_sh3.png`**
```
{STYLE}, {YOUNG}, standing in front of a fogged bathroom mirror after a shower, white towel around her body, finger writing in the condensation, playful sly smile, soft steam glow --ar 1:1
```

### Пак «Ветер у моря» (`lawind`)
Платья — до колена и ниже, ветер лишь играет тканью.
**`y_wn1.png`**
```
{STYLE}, {YOUNG}, on a windy seaside promenade, knee-length light summer dress with the hem lifting slightly in the wind, one hand gently pressing the skirt, laughing, sea and sunset behind --ar 1:1
```
**`y_wn2.png`**
```
{STYLE}, {YOUNG}, holding her straw hat against the sea wind, knee-length dress fluttering, loose hair streaming, a seagull flying by, bright breezy seaside, joyful expression --ar 1:1
```
**`y_wn3.png`**
```
{STYLE}, {YOUNG}, standing at the end of a wooden pier, long flowing dress, silk scarf lifted by the wind, calm sea at golden hour, dreamy romantic mood --ar 1:1
```

### Пак «Утро в номере» (`lahotel`)
**`y_ht1.png`**
```
{STYLE}, {YOUNG}, in a hotel room at sunrise, light silk robe over a simple camisole, holding a cup of coffee by a huge window with morning city view, golden light, sleepy gentle smile --ar 1:1
```
**`y_ht2.png`**
```
{STYLE}, {YOUNG}, sitting on a hotel bed, silk robe loosely over her shoulder, looking out of a big window at the sunset skyline, holding a glass of sparkling water, soft warm light, calm thoughtful mood --ar 1:1
```
**`y_ht3.png`**
```
{STYLE}, {YOUNG}, by a hotel window with a view of the sea, silk robe, hair down in soft waves, hands around a warm cup, sunrise colors outside, serene adult morning --ar 1:1
```

### Пак «Парная» (`lasauna`)
Полотенце закрывает фигуру от плеч до колен, пар прикрывает фон — никаких откровенных поз.
**`y_sa1.png`**
```
{STYLE}, {YOUNG}, in a wooden sauna, wrapped in a white terry towel shoulders-to-knees, a sprig of mint in a wooden bucket, gentle steam, warm wood tones, peaceful expression --ar 1:1
```
**`y_sa2.png`**
```
{STYLE}, {YOUNG}, in a wooden sauna, white towel wrapped shoulders-to-knees, damp dark hair, playful squint through wisps of steam, relaxed confident smile --ar 1:1
```
**`y_sa3.png`**
```
{STYLE}, {YOUNG}, sitting on a sauna bench wrapped in a towel, holding a mug of herbal tea, steam swirling in warm light, dreamy calm mood --ar 1:1
```

### Пак «Лазурь бассейна» (`lapool`)
**`y_pl1.png`**
```
{STYLE}, {YOUNG}, at an outdoor pool on a bright day, modest elegant swimsuit, walking along the edge with a towel over her arm, water sparkles, confident adult summer look --ar 1:1
```
**`y_pl2.png`**
```
{STYLE}, {YOUNG}, sitting at the pool edge with her feet in the water, modest one-piece swimsuit, wet glossy hair, sun reflections on the water, relaxed inviting smile --ar 1:1
```
**`y_pl3.png`**
```
{STYLE}, {YOUNG}, chest-deep in a pool, modest swimsuit straps visible, wet hair slicked back, splashing water droplets sparkling in the sun, playful smile --ar 1:1
```

### Пак «Палуба на закате» (`ladeck`)
**`y_dk1.png`**
```
{STYLE}, {YOUNG}, on a cruise ship deck at sunset, knee-length evening dress fluttering in the sea breeze, holding the railing, golden horizon behind, elegant joyful look --ar 1:1
```
**`y_dk2.png`**
```
{STYLE}, {YOUNG}, leaning on the deck railing at sunset, light evening dress, loose hair in the wind, sun low over the sea, warm cinematic light, thoughtful soft smile --ar 1:1
```
**`y_dk3.png`**
```
{STYLE}, {YOUNG}, on a ship deck in an elegant evening dress, holding a glass of sparkling water, ship lights starting to glow in dusk, wind in the fabric, refined adult evening --ar 1:1
```

### Пак «Неон над городом» (`labar`)
**`y_rf1.png`**
```
{STYLE}, {YOUNG}, at a rooftop lounge above a city at night, elegant evening dress, holding a mocktail, city lights and neon bokeh behind, confident stylish look --ar 1:1
```
**`y_rf2.png`**
```
{STYLE}, {YOUNG}, standing at a rooftop bar railing, elegant fitted evening dress, night city glowing below, string lights overhead, wind in her hair, calm mesmerizing smile --ar 1:1
```
**`y_rf3.png`**
```
{STYLE}, {YOUNG}, seated in a rooftop lounge armchair, evening dress, soft neon glow, a jazz band blurred in the background, relaxed elegant mood --ar 1:1
```

### Пак «Шёлк и подсвечник» (`lanight`)
Самый «приватный» пак: домашний вечер, свечи, шёлк. Откровенности нет — всё закрыто, настроение держится светом.
**`y_br1.png`**
```
{STYLE}, {YOUNG}, in a cozy bedroom at night, sitting on the bed in a silk robe, candles on the bedside table, an open book in her lap, warm flickering light, intimate calm atmosphere --ar 1:1
```
**`y_br2.png`**
```
{STYLE}, {YOUNG}, standing by a dark window at night in a silk robe, city lights and a moon outside, candlelight from the room behind her, quiet dreamy mood --ar 1:1
```
**`y_br3.png`**
```
{STYLE}, {YOUNG}, curled up in bed with a cup of tea, silk robe, soft candlelight, night sky through the window, gentle content smile, warm private evening --ar 1:1
```

---

## 6. Чек-лист перед заменой файлов

- [ ] Аватарки всех 9 персонажей сгенерированы и утверждены (они — референсы лиц).
- [ ] Все кадры одного персонажа сделаны через референс его аватара.
- [ ] Размер: аватарки ≥512², кадры 800² (или 1024² — игра масштабирует), формат PNG.
- [ ] Имена файлов совпадают с существующими `photos/*.png`.
- [ ] На картинках нет текста и подписей.
- [ ] Одежда скромная, кадры проходят модерацию площадок.
- [ ] Кадры Premium-серии «Спустя 10 лет» — только со взрослыми паспортами `{KATYA_AD}`/`{SVETA_AD}`/`{ANYA_AD}`/`{VIKA_AD}`, без школьного контекста.
- [ ] Кадры Premium-серии «Елизавета Андреевна: приватные фотосеты» — только с паспортом `{YOUNG}` (учительница взрослая), без школьного контекста; скромные купальники и полотенца, проходят модерацию.
