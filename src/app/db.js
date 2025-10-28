const mongoose = require('mongoose');

const {
  MONGO_USERNAME,
  MONGO_PASSWORD,
  MONGO_HOSTNAME,
  MONGO_PORT,
  MONGO_DB
} = process.env;

// Опции подключения с ограниченными попытками и таймаутами
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true, // Рекомендуется для новых версий Mongoose
  reconnectTries: 3,         // Ограничиваем количество попыток
  reconnectInterval: 1000,   // Интервал между попытками (1 секунда)
  connectTimeoutMS: 5000,    // Таймаут подключения (5 секунд)
};

const url = `mongodb+srv://${MONGO_USERNAME}:${MONGO_PASSWORD}@${MONGO_HOSTNAME}/${MONGO_DB}?retryWrites=true&w=majority`;

// Обёртка в асинхронную функцию для изоляции ошибок
(async () => {
  try {
    await mongoose.connect(url, options);
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.warn('MongoDB connection failed. Continuing without DB support.');
    console.error(err.message); // Логируем только сообщение ошибки
  }
})();

module.exports = mongoose;
