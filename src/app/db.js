const mongoose = require('mongoose');

const READY_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

let lastConnectionError = null;
let lastConnectionEventAt = null;

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

function getDbStatus() {
  const readyState = mongoose?.connection?.readyState ?? 0;

  return {
    readyState,
    state: READY_STATES[readyState] || 'unknown',
    hasConfiguration: Boolean(url),
    dbName: mongoose?.connection?.name || MONGO_DB || null,
    host: mongoose?.connection?.host || MONGO_HOSTNAME || null,
    lastConnectionError,
    lastConnectionEventAt,
  };
}

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

mongoose.getDbStatus = getDbStatus;

mongoose.connection.on('connected', () => {
  lastConnectionError = null;
  lastConnectionEventAt = new Date().toISOString();
});

mongoose.connection.on('disconnected', () => {
  lastConnectionEventAt = new Date().toISOString();
});

mongoose.connection.on('error', (error) => {
  lastConnectionError = error?.message || String(error);
  lastConnectionEventAt = new Date().toISOString();
});

(async () => {
  if (!url) {
    lastConnectionError = 'MongoDB configuration is missing';
    lastConnectionEventAt = new Date().toISOString();
    console.warn('MongoDB configuration is missing. Continuing without DB support.');
    return;
  }

  try {
    await mongoose.connect(url, options);
    console.log('MongoDB connected successfully');
  } catch (err) {
    lastConnectionError = err.message;
    lastConnectionEventAt = new Date().toISOString();
    console.warn('MongoDB connection failed. Continuing without DB support.');
    console.error(err.message);
  }
})();

module.exports = mongoose;
