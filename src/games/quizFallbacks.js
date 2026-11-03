'use strict';

const quizWords = require('../data/quizWords');

const anagramWords = [
  'компас', 'термометр', 'микроскоп', 'телескоп', 'будильник',
  'зеркало', 'микрофон', 'фонарик', 'рюкзак', 'скрепка',
  'линейка', 'ластик', 'конверт', 'радуга', 'вулкан',
  'айсберг', 'кактус', 'бобр', 'дятел', 'хамелеон',
  'паутина', 'одуванчик', 'желудь', 'гусеница', 'маяк',
  'комета', 'снежинка', 'ножницы', 'велосипед', 'гитара',
];

function anagramEntry(answer) {
  return { clue: `Анаграмма: ${answer}`, answers: [answer] };
}

const games = [
  { clue: '🧱 ⛏️ 💎 🧟‍♂️', answers: ['Майнкрафт', 'Minecraft'] },
  { clue: '🟠 🔵 🧩 🚪', answers: ['Портал', 'Portal'] },
  { clue: '🟥 🟦 🟩 🟨 ⬇️ 🧩', answers: ['Тетрис', 'Tetris'] },
  { clue: '🚀 🧑‍🚀 🗳️ 🔪', answers: ['Амонг Ас', 'Among Us'] },
  { clue: '🏠 🟩 💎 🧍', answers: ['Симс', 'The Sims', 'Симс 4', 'The Sims 4'] },
  { clue: '🎯 🔫 💣 🛡️ 💰', answers: ['Контр Страйк', 'Counter Strike', 'Counter-Strike', 'CS2'] },
  { clue: '🚗 🚔 💰 🏙️', answers: ['ГТА', 'GTA', 'ГТА 5', 'GTA 5', 'Grand Theft Auto'] },
  { clue: '🤠 🐎 🔫 🌵', answers: ['Ред Дед Редемпшен', 'Red Dead Redemption', 'RDR2'] },
  { clue: '🐉 ❄️ 🗡️ 🏔️', answers: ['Скайрим', 'Skyrim', 'The Elder Scrolls V Skyrim'] },
  { clue: '🍄 👨‍🔧 🐢 👸', answers: ['Супер Марио', 'Марио', 'Super Mario', 'Super Mario Bros'] },
  { clue: '👽 🔫 🌀 🧪', answers: ['Халф Лайф', 'Half Life', 'Half-Life'] },
  { clue: '🚀 👾 🕹️ 🔫', answers: ['Дум', 'Doom'] },
  { clue: '🧟 🔦 🏚️ 🧰', answers: ['Резидент Ивил', 'Resident Evil', 'Обитель зла'] },
  { clue: '🧒 ⚔️ 🌿 🏰', answers: ['Зельда', 'The Legend of Zelda', 'Легенда о Зельде'] },
  { clue: '🌾 🐓 🎣 🏡', answers: ['Стардью Вэлли', 'Stardew Valley'] },
  { clue: '🌊 🤿 🐠 🛠️', answers: ['Сабнавтика', 'Subnautica'] },
  { clue: '🧑‍🚀 🌌 👾 🔫', answers: ['Хало', 'Halo'] },
  { clue: '👑 ⚔️ 🐉 🧙', answers: ['Ведьмак', 'The Witcher', 'Ведьмак 3', 'The Witcher 3'] },
  { clue: '🏃 🧱 🥷 🗡️', answers: ['Ассасинс Крид', 'Assassins Creed', "Assassin's Creed"] },
  { clue: '🐻 🍕 📹 🌙', answers: ['Пять ночей с Фредди', "Five Nights at Freddy's", 'FNAF'] },
  { clue: '🟡 👻 🍒 🕹️', answers: ['Пакман', 'Пак Ман', 'Pac-Man', 'Pacman'] },
  { clue: '🎮 🧱 🧑‍🤝‍🧑 🏙️', answers: ['Роблокс', 'Roblox'] },
  { clue: '🦆 🪿 🏘️ 🤏', answers: ['Антитлд гус гейм', 'Untitled Goose Game'] },
  { clue: '🪖 🔫 💥 🏜️', answers: ['Кол оф Дьюти', 'Call of Duty'] },
  { clue: '🌻 🌱 🧟 🏠', answers: ['Растения против зомби', 'Plants vs Zombies', 'Plants vs. Zombies'] },
];

const movies = [
  { clue: '🚢 🧊 💔 🌊', answers: ['Титаник', 'Titanic'] },
  { clue: '🦈 🌊 🚤 😱', answers: ['Челюсти', 'Jaws'] },
  { clue: '🌌 ⚔️ 🤖 ✨', answers: ['Звездные войны', 'Звёздные войны', 'Star Wars'] },
  { clue: '🧙‍♂️ 💍 🧝‍♂️ 🌋', answers: ['Властелин колец', 'The Lord of the Rings', 'Lord of the Rings'] },
  { clue: '⚡ 👓 🪄 🏰', answers: ['Гарри Поттер', 'Harry Potter'] },
  { clue: '🦁 👑 🌅', answers: ['Король лев', 'The Lion King'] },
  { clue: '🦖 🧬 🌴 🚙', answers: ['Парк Юрского периода', 'Jurassic Park'] },
  { clue: '🚗 ⏰ ⚡ 🕰️', answers: ['Назад в будущее', 'Back to the Future'] },
  { clue: '👦 🏠 🎄 🪤', answers: ['Один дома', 'Home Alone'] },
  { clue: '💊 🔴 🔵 🕶️', answers: ['Матрица', 'The Matrix'] },
  { clue: '🌊 🏝️ 🔵 🏹', answers: ['Аватар', 'Avatar'] },
  { clue: '❄️ 👭 ⛄ 🏰', answers: ['Холодное сердце', 'Frozen'] },
  { clue: '🟢 👹 🧅 🏰', answers: ['Шрек', 'Shrek'] },
  { clue: '🤠 🧸 🚀 🧒', answers: ['История игрушек', 'Toy Story'] },
  { clue: '🐠 🌊 🐢 🔍', answers: ['В поисках Немо', 'Finding Nemo'] },
  { clue: '🏴‍☠️ 🚢 🏝️ 🧭', answers: ['Пираты Карибского моря', 'Pirates of the Caribbean'] },
  { clue: '🕷️ 🧑 🏙️ 🕸️', answers: ['Человек паук', 'Spider-Man', 'Spider Man'] },
  { clue: '🌀 🛌 🏙️ 🧠', answers: ['Начало', 'Inception'] },
  { clue: '🤵 🍷 👨‍👦 🔫', answers: ['Крестный отец', 'Крёстный отец', 'The Godfather'] },
  { clue: '🚘 💨 👮‍♂️ 🏁', answers: ['Форсаж', 'Fast and Furious'] },
  { clue: '👽 🚲 🌕 👆', answers: ['Инопланетянин', 'E.T.', 'ET'] },
  { clue: '🥊 🏃‍♂️ 🏆 🥩', answers: ['Рокки', 'Rocky'] },
  { clue: '🎈 🏠 👴 🐕', answers: ['Вверх', 'Up'] },
  { clue: '🌌 🚀 ⏳ 👨‍🚀', answers: ['Интерстеллар', 'Interstellar'] },
  { clue: '🧸 🔪 🩸 🧒', answers: ['Детские игры', 'Childs Play', "Child's Play", 'Чаки'] },
];

module.exports = {
  quiz: quizWords,
  anagram: anagramWords.map(anagramEntry),
  game: games,
  movie: movies,
};
