/// ==========================================
// File: backend/server.js
// IoT Dashboard Backend Server (Express + Socket.IO + MongoDB + SerialPort)
// ==========================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Parser } = require('json2csv');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// --- 1. Express & HTTP Server Initialization ---
const app = express();
const server = http.createServer(app);

// --- 2. CORS & Environment Setup ---
// ดึง Domain ของ Frontend จาก Environment Variables หรือเปิดกว้าง * เป็นค่าเริ่มต้น
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const io = new Server(server, { 
  cors: { 
    origin: FRONTEND_URL,
    methods: ["GET", "POST"]
  } 
});

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// ค่า Secrets และ Database Connection String
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dashboard_db';

// --- 3. Database Connection ---
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 4. MongoDB Schemas & Models ---

// Schema สำหรับจัดเก็บข้อมูลผู้ใช้งาน (Authentication)
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// Schema สำหรับจัดเก็บการตั้งค่าความถี่การบันทึกข้อมูลของผู้ใช้
const SettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  saveInterval: { type: String, default: 'realtime' } // 'realtime', '10s', '5m', '1h'
});
const Settings = mongoose.model('Settings', SettingsSchema);

// Schema สำหรับจัดเก็บค่าเซนเซอร์ที่อ่านได้จาก ESP32
const SensorDataSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String, default: 'Unknow' },
  voltage: Number,
  resistance: Number,
  current: Number,
  ldr: Number,
  btn1Raw: Number,
  btn1Debounced: Number,
  btn2Raw: Number,
  btn2Debounced: Number,
  timestamp: { type: Date, default: Date.now }
});
const SensorData = mongoose.model('SensorData', SensorDataSchema);

// --- 5. Authentication Routes ---

// API ลงทะเบียนผู้ใช้งานใหม่
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword });
    
    // สร้างค่า Settings เริ่มต้นให้ผู้ใช้เป็น 'realtime'
    await Settings.create({ userId: user._id.toString(), saveInterval: 'realtime' });
    res.json({ success: true, message: 'Registered successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API เข้าสู่ระบบ (แจก JWT Token)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
    res.json({ token, username: user.username, userId: user._id });
  } else {
    res.status(401).json({ error: 'Invalid Credentials' });
  }
});

// API ตรวจสอบสถานะ User จาก Token (Auto Login)
app.get('/api/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ userId: decoded.userId, username: decoded.username, token });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- 6. Data Management Routes ---

// API สำหรับดาวน์โหลดข้อมูลเซนเซอร์ย้อนหลังเป็นไฟล์ CSV
app.get('/api/download-csv', async (req, res) => {
  const token = req.query.token || req.headers.authorization?.split(' ')[1];
  let currentUserId = 'unknow';
  let currentUsername = 'Unknow';

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      currentUserId = decoded.userId;
      currentUsername = decoded.username || 'Unknow';
    } catch (err) {}
  }

  try {
    const data = await SensorData.find({ userId: currentUserId }).sort({ timestamp: -1 }).limit(1000);
    const formattedData = data.map(item => ({
      user: item.username || currentUsername,
      timestamp: item.timestamp,
      voltage: item.voltage,
      resistance: item.resistance,
      current: item.current,
      ldr: item.ldr,
      btn1Raw: item.btn1Raw,
      btn1Debounced: item.btn1Debounced,
      btn2Raw: item.btn2Raw,
      btn2Debounced: item.btn2Debounced
    }));

    const fields = ['user', 'timestamp', 'voltage', 'resistance', 'current', 'ldr', 'btn1Raw', 'btn1Debounced', 'btn2Raw', 'btn2Debounced'];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(formattedData);

    res.header('Content-Type', 'text/csv');
    res.attachment(`sensor_data_${currentUsername}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV');
  }
});

// API อัปเดตการตั้งค่าความถี่บันทึกข้อมูล (และส่งคำสั่งผ่าน Serial ไปยัง ESP32)
app.post('/api/settings', async (req, res) => {
  try {
    const { userId, saveInterval } = req.body;
    const targetUser = userId || 'unknow';
    
    await Settings.findOneAndUpdate(
      { userId: targetUser }, 
      { saveInterval }, 
      { upsert: true, new: true }
    );

    // หากมีพอร์ต Serial เปิดใช้งานอยู่ (ในโหมด Local) ให้ส่งคำสั่งสั่งการลงไปยัง ESP32
    if (currentPort && currentPort.isOpen) {
      const command = `SET_INTERVAL:${saveInterval}\n`;
      currentPort.write(command, (err) => {
        if (err) {
          console.error('❌ Failed to write to serial:', err.message);
        } else {
          currentPort.drain(() => {
            console.log(`📡 Sent interval command to ESP32: SET_INTERVAL:${saveInterval}`);
          });
        }
      });
    }

    // กระจายสถานะการเปลี่ยน Setting ไปยัง Client ทุกตัว
    io.emit('setting_updated', { userId: targetUser, saveInterval });
    res.json({ success: true, message: `Setting updated to ${saveInterval}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API ล้างข้อมูลเซนเซอร์ของผู้ใช้
app.delete('/api/clear-data', async (req, res) => {
  const { userId } = req.body;
  const targetUser = userId || 'unknow';
  await SensorData.deleteMany({ userId: targetUser });
  res.json({ success: true, message: 'Data cleared successfully' });
});

// --- 7. Serial Connection & Realtime Data Handling ---

let lastSavedTimes = {};
let currentPort = null;
let isConnecting = false;

const STATIC_PORT = process.env.SERIAL_PORT || 'COM1';

// ฟังก์ชันค้นหาและเชื่อมต่อกับบอร์ด ESP32 ผ่านพอร์ต Serial
async function autoConnectESP32() {
  // [ส่วนแก้ไขป้องกัน Error udevadm] หากรันอยู่บน Render (สภาพแวดล้อม Cloud) ให้ข้ามการค้นหาพอร์ต Physical
  if (process.env.RENDER) {
    console.log('☁️ Running on Render environment: Skipping physical Serial Port auto-connect.');
    return;
  }

  if (isConnecting) return;
  isConnecting = true;

  try {
    const ports = await SerialPort.list();
    
    // ค้นหาพอร์ตที่มี Vendor ตรงกับชิปของบอร์ด ESP32/USB-Serial
    let espPort = ports.find(p => {
      const vendor = (p.manufacturer || '').toLowerCase();
      const pPath = (p.path || '').toLowerCase();
      const vId = (p.vendorId || '').toLowerCase();

      // ข้ามตัวรับสัญญาณ Mobile Broadband
      if (vendor.includes('mobile broadband') || vendor.includes('broadband') || vendor.includes('ericsson')) {
        return false;
      }

      return (
        vendor.includes('wch') ||
        vendor.includes('ch34') ||
        vendor.includes('espressif') ||
        vendor.includes('silicon labs') ||
        vendor.includes('ftdi') ||
        vendor.includes('usb-enhanced-serial') ||
        vId.includes('303a') ||
        vId.includes('1a86') ||
        pPath.includes('ttyusb') ||
        pPath.includes('ttyacm')
      );
    });

    let selectedPortPath = espPort ? espPort.path : STATIC_PORT;

    console.log(`🔌 Connecting to ESP32 on port: ${selectedPortPath}`);
    currentPort = new SerialPort({ path: selectedPortPath, baudRate: 115200 });
    const parser = currentPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    // เมื่อมีข้อมูลส่งมาจาก ESP32 ผ่านสาย Serial
    parser.on('data', async (data) => {
      const rawText = data.trim();
      // กรองเฉพาะข้อความที่เป็นรูปแบบ JSON
      if (!rawText.startsWith('{') || !rawText.endsWith('}')) return;

      try {
        const payload = JSON.parse(rawText);
        
        // 1. กระจายข้อมูลไปให้ Frontend แสดงผลบน กราฟ และ Dashboard แบบ Realtime
        io.emit('dashboard_update', payload);

        // 2. ตรวจสอบการบันทึกลง Database ตามระยะเวลาที่แต่ละ User กำหนดไว้
        let activeSettings = await Settings.find();
        if (!activeSettings.some(s => s.userId === 'unknow')) {
          const defaultUnknowSetting = await Settings.create({ userId: 'unknow', saveInterval: 'realtime' });
          activeSettings.push(defaultUnknowSetting);
        }

        const now = Date.now();
        for (let setting of activeSettings) {
          const uId = setting.userId;
          const lastSaved = lastSavedTimes[uId] || 0;
          let shouldSave = false;

          // เช็กเงื่อนไขเวลาบันทึก
          if (setting.saveInterval === 'realtime') shouldSave = true;
          else if (setting.saveInterval === '10s' && now - lastSaved >= 10000) shouldSave = true;
          else if (setting.saveInterval === '5m' && now - lastSaved >= 300000) shouldSave = true;
          else if (setting.saveInterval === '1h' && now - lastSaved >= 3600000) shouldSave = true;

          if (shouldSave) {
            lastSavedTimes[uId] = now;
            let username = 'Unknow';
            if (uId !== 'unknow') {
              try {
                const uObj = await User.findById(uId);
                if (uObj) username = uObj.username;
              } catch (e) {}
            }

            // บันทึกข้อมูลลง MongoDB
            await SensorData.create({
              userId: uId,
              username: username,
              ...payload
            });
          }
        }
      } catch (e) {}
    });

    currentPort.on('error', (err) => {
      console.error('❌ Serial Port Error:', err.message);
      reconnectSerial();
    });

    currentPort.on('close', () => {
      console.log('⚠️ Serial Port Closed. Retrying...');
      reconnectSerial();
    });

  } catch (e) {
    console.error('❌ Error auto-connecting:', e.message);
    reconnectSerial();
  } finally {
    isConnecting = false;
  }
}

// ฟังก์ชันพยายามเชื่อมต่อ Serial ใหม่เมื่อหลุด
function reconnectSerial() {
  if (currentPort) {
    currentPort.removeAllListeners();
    if (currentPort.isOpen) currentPort.close();
    currentPort = null;
  }
  setTimeout(autoConnectESP32, 5000);
}

// เริ่มระบบค้นหาการเชื่อมต่อ ESP32
autoConnectESP32();

// --- 8. Socket.IO Connection Event ---
io.on('connection', (socket) => {
  console.log('⚡ Client Connected:', socket.id);
});

// --- 9. Start Web Server ---
// ใช้ PORT จาก Environment Variable (Render) หรือ พอร์ต 5000 เมื่อรันในเครื่อง
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));


// Static port connection for UART communication with ESP32-S3
// Communicate UART : Static COM1, line 120
// 1. ใส่ไว้บรรทัดแรกสุดของไฟล์
// require('dotenv').config();

// 2. ใส่ console.log บรรทัดนี้เพื่อเช็กค่าที่อ่านได้
// console.log('MONGO_URI is:', process.env.MONGO_URI);

// // File: backend/server.js
// const express = require('express');
// const http = require('http');
// const mongoose = require('mongoose');
// const { Server } = require('socket.io');
// const cors = require('cors');
// const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');
// const { Parser } = require('json2csv');
// const { SerialPort } = require('serialport');
// const { ReadlineParser } = require('@serialport/parser-readline');

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, { cors: { origin: '*' } });

// app.use(cors());
// app.use(express.json());

// // ดึงค่ามาใช้งานผ่าน process.env
// const JWT_SECRET = process.env.JWT_SECRET;

// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log('MongoDB Connected successfully!'))
//   .catch(err => console.error('MongoDB Connection Error:', err));

// // --- MongoDB Schemas ---
// const UserSchema = new mongoose.Schema({
//   username: { type: String, required: true, unique: true },
//   password: { type: String, required: true }
// });
// const User = mongoose.model('User', UserSchema);

// const SettingsSchema = new mongoose.Schema({
//   userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   saveInterval: { type: String, default: 'realtime' } // 'realtime', '10s', '5m', '1h'
// });
// const Settings = mongoose.model('Settings', SettingsSchema);

// const SensorDataSchema = new mongoose.Schema({
//   userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   voltage: Number,
//   resistance: Number,
//   current: Number,
//   ldr: Number,
//   btn1Raw: Number,
//   btn1Debounced: Number,
//   btn2Raw: Number,
//   btn2Debounced: Number,
//   timestamp: { type: Date, default: Date.now }
// });
// const SensorData = mongoose.model('SensorData', SensorDataSchema);

// // --- Auth Routes ---
// app.post('/api/register', async (req, res) => {
//   try {
//     const { username, password } = req.body;
//     const hashedPassword = await bcrypt.hash(password, 10);
//     const user = await User.create({ username, password: hashedPassword });
//     await Settings.create({ userId: user._id, saveInterval: 'realtime' });
//     res.json({ success: true, message: 'Registered successfully' });
//   } catch (err) {
//     res.status(400).json({ error: err.message });
//   }
// });

// app.post('/api/login', async (req, res) => {
//   const { username, password } = req.body;
//   const user = await User.findOne({ username });
//   if (user && await bcrypt.compare(password, user.password)) {
//     const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
//     res.json({ token, username: user.username, userId: user._id });
//   } else {
//     res.status(401).json({ error: 'Invalid Credentials' });
//   }
// });

// // --- Data Export & Management Routes ---
// app.get('/api/download-csv', async (req, res) => {
//   const token = req.query.token || req.headers.authorization?.split(' ')[1];
//   if (!token) return res.status(401).send('Unauthorized');
  
//   try {
//     const decoded = jwt.verify(token, JWT_SECRET);
//     const data = await SensorData.find({ userId: decoded.userId }).sort({ timestamp: -1 }).limit(1000);
    
//     const fields = ['timestamp', 'voltage', 'resistance', 'current', 'ldr', 'btn1Raw', 'btn1Debounced', 'btn2Raw', 'btn2Debounced'];
//     const json2csvParser = new Parser({ fields });
//     const csv = json2csvParser.parse(data);

//     res.header('Content-Type', 'text/csv');
//     res.attachment('sensor_data.csv');
//     res.send(csv);
//   } catch (err) {
//     res.status(500).send('Error generating CSV');
//   }
// });

// app.post('/api/settings', async (req, res) => {
//   const { userId, saveInterval } = req.body;
//   await Settings.findOneAndUpdate({ userId }, { saveInterval }, { upsert: true });
//   res.json({ success: true });
// });

// app.delete('/api/clear-data', async (req, res) => {
//   const { userId } = req.body;
//   await SensorData.deleteMany({ userId });
//   res.json({ success: true, message: 'Data cleared' });
// });

// // --- Serial Connection & Realtime Handling ---
// const SERIAL_PORT_PATH = 'COM1'; // ปรับตาม Serial Port ของระบบ
// let lastSavedTimes = {};

// let port;
// try {
//   port = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: 115200 });
//   const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

//   parser.on('data', async (data) => {
//     try {
//       const payload = JSON.parse(data.trim());
      
//       // 1. Broadcast ไปยัง Frontend ทุกเครื่อง
//       io.emit('dashboard_update', payload);

//       // 2. บันทึกลง DB ตาม Setting ของ User ที่ active
//       const activeUsers = await Settings.find();
//       const now = Date.now();

//       for (let setting of activeUsers) {
//         const uId = setting.userId.toString();
//         const lastSaved = lastSavedTimes[uId] || 0;
//         let shouldSave = false;

//         if (setting.saveInterval === 'realtime') shouldSave = true;
//         else if (setting.saveInterval === '10s' && now - lastSaved >= 10000) shouldSave = true;
//         else if (setting.saveInterval === '5m' && now - lastSaved >= 300000) shouldSave = true;
//         else if (setting.saveInterval === '1h' && now - lastSaved >= 3600000) shouldSave = true;

//         if (shouldSave) {
//           lastSavedTimes[uId] = now;
//           await SensorData.create({
//             userId: setting.userId,
//             ...payload
//           });
//         }
//       }
//     } catch (e) {
//       // Ignored non-json lines
//     }
//   });

//   port.on('error', (err) => console.error('Serial Error:', err.message));
// } catch (e) {
//   console.log('Serial Port initialization failed or not connected.');
// }

// io.on('connection', (socket) => {
//   console.log('Client connected:', socket.id);
// });

// const PORT = 5000;
// server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));


