const mongoose = require('mongoose');

const {
  MONGO_URI,
  MONGO_USERNAME,
  MONGO_PASSWORD,
  MONGO_HOSTNAME,
  MONGO_PORT,
  MONGO_DB
} = process.env;

const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
};

function buildMongoUrl() {
  if (MONGO_URI) {
    return MONGO_URI;
  }

  if (!MONGO_HOSTNAME || !MONGO_DB) {
    return null;
  }

  if (/^mongodb(\+srv)?:\/\//.test(MONGO_HOSTNAME)) {
    return MONGO_HOSTNAME;
  }

  const credentials = MONGO_USERNAME && MONGO_PASSWORD
    ? `${encodeURIComponent(MONGO_USERNAME)}:${encodeURIComponent(MONGO_PASSWORD)}@`
    : '';
  const isStandardMongoUrl = MONGO_HOSTNAME.includes(',') || MONGO_HOSTNAME.includes(':') || Boolean(MONGO_PORT);
  const protocol = isStandardMongoUrl ? 'mongodb://' : 'mongodb+srv://';
  const host = MONGO_PORT && !MONGO_HOSTNAME.includes(':')
    ? `${MONGO_HOSTNAME}:${MONGO_PORT}`
    : MONGO_HOSTNAME;

  return `${protocol}${credentials}${host}/${MONGO_DB}?retryWrites=true&w=majority`;
}

const url = buildMongoUrl();

(async () => {
  if (!url) {
    console.warn('MongoDB configuration is missing. Continuing without DB support.');
    return;
  }

  try {
    await mongoose.connect(url, options);
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.warn('MongoDB connection failed. Continuing without DB support.');
    console.error(err.message);
  }
})();

module.exports = mongoose;
