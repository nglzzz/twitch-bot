require('dotenv').config();

const config = {
  ...process.env,
  // Таймзона для отображения дат/времени в интерфейсе.
  // По умолчанию Europe/Minsk (UTC+3). Переопределяется только через env TZ_DISPLAY.
  // TZ задаёт таймзону процесса и не влияет на отображение.
  TIMEZONE: process.env.TZ_DISPLAY || 'Europe/Minsk',
};

module.exports = config;
