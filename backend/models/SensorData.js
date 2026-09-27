const mongoose = require('mongoose');

const SensorDataSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  voltage: Number,
  resistance: Number,
  current: Number,
  ldr: Number,
  button1: Boolean,
  button2: Boolean,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SensorData', SensorDataSchema);