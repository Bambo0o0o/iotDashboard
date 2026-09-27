// ============================================================================
// File: frontend/src/App.jsx
// IoT Dashboard Frontend (React + Socket.IO + Chart.js + Tailwind CSS)
// ============================================================================
import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// --- Backend Base URL Configuration ---
// กำหนด URL ของ Render Backend
const BACKEND_URL = 'https://iotdashboard-mq5d.onrender.com';

// เชื่อมต่อ Socket.IO ไปยัง Server บน Render
const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true
});

// ================= ANALOG NEEDLE GAUGE COMPONENT =================
function AnalogGauge({ value, min = 0, max = 100, unit = '', color = '#3b82f6', darkMode }) {
  const clampedValue = Math.min(Math.max(value, min), max);
  const percentage = (clampedValue - min) / (max - min);
  const angle = -90 + percentage * 180;

  const radian = (angle * Math.PI) / 180;
  const needleX = 100 + 65 * Math.sin(radian);
  const needleY = 100 - 65 * Math.cos(radian);

  return (
    <div className="flex flex-col items-center justify-center w-full">
      <svg viewBox="0 0 200 120" className="w-48 h-28 overflow-visible">
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={darkMode ? '#374151' : '#e5e7eb'}
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray="251.2"
          strokeDashoffset={251.2 * (1 - percentage)}
          className="transition-all duration-300 ease-out"
        />
        {[-90, -45, 0, 45, 90].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 100 + 72 * Math.sin(rad);
          const y1 = 100 - 72 * Math.cos(rad);
          const x2 = 100 + 80 * Math.sin(rad);
          const y2 = 100 - 80 * Math.cos(rad);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={darkMode ? '#9ca3af' : '#6b7280'}
              strokeWidth="2"
            />
          );
        })}
        <line
          x1="100"
          y1="100"
          x2={needleX}
          y2={needleY}
          stroke="#ef4444"
          strokeWidth="3.5"
          strokeLinecap="round"
          className="transition-all duration-300 ease-out"
        />
        <circle cx="100" cy="100" r="7" fill={darkMode ? '#f3f4f6' : '#1f2937'} />
        <circle cx="100" cy="100" r="3" fill="#ef4444" />
      </svg>

      <div className="text-center mt-[-10px]">
        <span className="text-3xl font-extrabold" style={{ color }}>
          {typeof value === 'number' ? (value % 1 === 0 ? value : value.toFixed(2)) : value}
        </span>
        <span className="text-lg font-semibold ml-1 text-gray-400">{unit}</span>
      </div>
    </div>
  );
}

// ================= MAIN APP COMPONENT =================
export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState(null);
  const [isRegister, setIsRegister] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [saveInterval, setSaveInterval] = useState('realtime');
  const [isConnected, setIsConnected] = useState(socket.connected);

  const [sensor, setSensor] = useState({
    voltage: 0, resistance: 0, current: 0, ldr: 0,
    btn1Raw: 0, btn1Debounced: 0, btn2Raw: 0, btn2Debounced: 0
  });

  const [analogHistory, setAnalogHistory] = useState([]);
  const [digitalHistory, setDigitalHistory] = useState([]);
  const [bandwidth, setBandwidth] = useState(0);

  // ตรวจสอบ Token เมื่อเริ่มต้นเข้าเว็บ (Auto-login)
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('token');

    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
    } else if (savedToken) {
      fetch(`${BACKEND_URL}/api/me`, {
        headers: { Authorization: `Bearer ${savedToken}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.userId) {
            const userData = { username: data.username, userId: data.userId, token: savedToken };
            setUser(userData);
            localStorage.setItem('user', JSON.stringify(userData));
          } else {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
          }
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        });
    }
  }, []);

  // Sync ค่า Setting ไปยัง Backend เมื่อเริ่มต้นโหลดแอป หรือเปลี่ยนสถานะผู้ใช้
  useEffect(() => {
    const syncInitialSettings = async () => {
      try {
        await fetch(`${BACKEND_URL}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user ? user.userId : 'unknow',
            saveInterval: saveInterval
          })
        });
      } catch (err) {
        console.error('Failed to sync initial settings:', err);
      }
    };

    syncInitialSettings();
  }, [user]);

  // ดักจับ Socket Events จาก Backend
  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    socket.on('dashboard_update', (data) => {
      setSensor(data);
      const timeStr = new Date().toLocaleTimeString();
      setBandwidth(JSON.stringify(data).length);

      setAnalogHistory(prev => [
        ...prev.slice(-19),
        { time: timeStr, ldr: data.ldr || 0, v: data.voltage || 0, r: data.resistance || 0, i: data.current || 0 }
      ]);

      setDigitalHistory(prev => [
        ...prev.slice(-19),
        { 
          time: timeStr, 
          b1Raw: data.btn1Raw || 0, 
          b1Clean: data.btn1Debounced || 0, 
          b2Raw: data.btn2Raw || 0, 
          b2Clean: data.btn2Debounced || 0 
        }
      ]);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('dashboard_update');
    };
  }, []);

  // ฟังก์ชัน Login / Register
  const handleAuth = async () => {
    const endpoint = isRegister ? '/api/register' : '/api/login';
    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();
      if (res.ok && !isRegister) {
        setUser(data);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data));
        setUsernameInput('');
        setPasswordInput('');
      } else if (isRegister && data.success) {
        alert('ลงทะเบียนสำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที');
        setIsRegister(false);
      } else {
        alert(data.error || 'การยืนยันตัวตนล้มเหลว');
      }
    } catch (err) {
      alert('ไม่สามารถเชื่อมต่อกับ Backend ได้');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  // ดาวน์โหลดไฟล์ CSV
  const handleDownloadCSV = () => {
    const token = localStorage.getItem('token') || '';
    window.open(`${BACKEND_URL}/api/download-csv?token=${token}`, '_blank');
  };

  // เปลี่ยนช่วงเวลาการบันทึกข้อมูล
  const handleSaveIntervalChange = async (e) => {
    const newInterval = e.target.value;
    setSaveInterval(newInterval);

    try {
      await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user ? user.userId : 'unknow',
          saveInterval: newInterval
        })
      });
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  // ล้างข้อมูลใน Database
  const handleClearData = async () => {
    if (!window.confirm('คุณต้องการลบข้อมูลที่บันทึกไว้ในระบบทั้งหมดใช่หรือไม่?')) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/clear-data`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user ? user.userId : 'unknow'
        })
      });
      const data = await res.json();
      alert(data.message || 'ลบข้อมูลสำเร็จแล้ว');
    } catch (err) {
      alert('ไม่สามารถลบข้อมูลได้');
    }
  };

  return (
    <div className={`min-h-screen p-4 transition-colors duration-200 ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}>
      
      {/* HEADER BAR */}
      <div className={`flex flex-wrap justify-between items-center p-4 rounded-lg shadow-md mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <h1 className="text-xl font-bold">My Dashboard</h1>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setDarkMode(!darkMode)} 
            className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1 text-sm"
          >
            {darkMode ? '☀️ Light' : '🌙 Dark'}
          </button>

          <button 
            onClick={handleDownloadCSV} 
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-1 shadow"
          >
            📥 Download
          </button>

          <button 
            onClick={handleClearData} 
            className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium flex items-center gap-1 shadow"
          >
            🗑️ Clear Data
          </button>

          <select 
            value={saveInterval} 
            onChange={handleSaveIntervalChange} 
            className="p-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 font-medium"
          >
            <option value="realtime">Setting: Realtime</option>
            <option value="10s">Setting: 10s</option>
            <option value="5m">Setting: 5m</option>
            <option value="1h">Setting: 1h</option>
          </select>

          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-green-500 font-bold text-sm">👤 {user.username}</span>
              <button 
                onClick={handleLogout} 
                className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs font-medium"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input 
                type="text" 
                placeholder="User" 
                value={usernameInput} 
                onChange={e => setUsernameInput(e.target.value)} 
                className="p-1 border rounded text-sm text-black w-20"
              />
              <input 
                type="password" 
                placeholder="Pass" 
                value={passwordInput} 
                onChange={e => setPasswordInput(e.target.value)} 
                className="p-1 border rounded text-sm text-black w-20"
              />
              <button onClick={handleAuth} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-sm font-medium">
                {isRegister ? 'Reg' : 'Login'}
              </button>
              <button onClick={() => setIsRegister(!isRegister)} className="text-xs text-blue-500 underline">
                {isRegister ? 'Login?' : 'Reg?'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ROW 1: GAUGES & LED STATUS */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        
        {/* Voltage Gauge */}
        <div className={`col-span-12 md:col-span-4 p-4 rounded-lg shadow-md flex flex-col justify-between items-center ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h2 className="text-md font-bold text-gray-400 mb-2">Voltage Gauge</h2>
          <AnalogGauge 
            value={sensor.voltage} 
            min={0} 
            max={3.3} 
            unit="V" 
            color="#3b82f6" 
            darkMode={darkMode} 
          />
          <div 
            className="w-full py-2 text-center rounded-md font-bold text-sm mt-3"
            style={{ backgroundColor: '#0f172a', color: '#38bdf8', border: '1px solid #1e293b' }}
          >
            Voltage Value: {sensor.voltage.toFixed(2)} V
          </div>
        </div>

        {/* Resistance Gauge */}
        <div className={`col-span-12 md:col-span-4 p-4 rounded-lg shadow-md flex flex-col justify-between items-center ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h2 className="text-md font-bold text-gray-400 mb-2">Resistance Gauge</h2>
          <AnalogGauge 
            value={sensor.resistance} 
            min={0} 
            max={10000} 
            unit="Ω" 
            color="#a855f7" 
            darkMode={darkMode} 
          />
          <div 
            className="w-full py-2 text-center rounded-md font-bold text-sm mt-3"
            style={{ backgroundColor: '#0f172a', color: '#c084fc', border: '1px solid #1e293b' }}
          >
            Resistance Value: {sensor.resistance.toFixed(0)} Ω
          </div>
        </div>

        {/* RED & GREEN LED Status */}
        <div className={`col-span-12 md:col-span-4 p-4 rounded-lg shadow-md flex flex-col justify-between ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="grid grid-cols-2 gap-2 h-full">
            <div className="flex flex-col items-center justify-center p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
              <span className="text-xs font-bold mb-2 text-center">RED LED Status<br/>Button1</span>
              <div className={`w-14 h-14 rounded-full transition-all duration-300 ${sensor.btn1Debounced ? 'bg-red-500 shadow-lg shadow-red-500/50 scale-105' : 'bg-gray-300 dark:bg-gray-700'}`}></div>
            </div>

            <div className="flex flex-col items-center justify-center p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
              <span className="text-xs font-bold mb-2 text-center">GREEN LED Status<br/>Button2</span>
              <div className={`w-14 h-14 rounded-full transition-all duration-300 ${sensor.btn2Debounced ? 'bg-green-500 shadow-lg shadow-green-500/50 scale-105' : 'bg-gray-300 dark:bg-gray-700'}`}></div>
            </div>
          </div>
          
          <div 
            className="w-full py-2 mt-2 text-center rounded-md font-bold text-sm"
            style={{ backgroundColor: '#0f172a', color: '#fbbf24', border: '1px solid #1e293b' }}
          >
            Current Gauge: {sensor.current.toFixed(2)} mA
          </div>
        </div>

      </div>

      {/* ROW 2: ANALOG & DIGITAL LINE GRAPHS */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        
        <div className={`col-span-12 md:col-span-6 p-4 rounded-lg shadow-md ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h3 className="text-md font-bold mb-3 text-gray-700 dark:text-gray-200">
            Analog line graph : LDR, Resistance, Voltage
          </h3>
          <div className="h-64">
            <Line
              data={{
                labels: analogHistory.map(h => h.time),
                datasets: [
                  { label: 'LDR Analog', data: analogHistory.map(h => h.ldr), borderColor: '#f59e0b', tension: 0.3 },
                  { label: 'Voltage (V)', data: analogHistory.map(h => h.v), borderColor: '#3b82f6', tension: 0.3 },
                  { label: 'Current (mA)', data: analogHistory.map(h => h.i), borderColor: '#10b981', tension: 0.3 }
                ]
              }}
              options={{ responsive: true, maintainAspectRatio: false, animation: false }}
            />
          </div>
        </div>

        <div className={`col-span-12 md:col-span-6 p-4 rounded-lg shadow-md ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h3 className="text-md font-bold mb-3 text-gray-700 dark:text-gray-200">
            Digital line graph : Button Noise vs Debounce
          </h3>
          <div className="h-64">
            <Line
              data={{
                labels: digitalHistory.map(h => h.time),
                datasets: [
                  { label: 'Btn1 Raw (Noise)', data: digitalHistory.map(h => h.b1Raw), borderColor: '#ef4444', stepped: true },
                  { label: 'Btn1 Debounced (Clean)', data: digitalHistory.map(h => h.b1Clean), borderColor: '#10b981', stepped: true },
                  { label: 'Btn2 Raw (Noise)', data: digitalHistory.map(h => h.b2Raw), borderColor: '#f97316', stepped: true },
                  { label: 'Btn2 Debounced (Clean)', data: digitalHistory.map(h => h.b2Clean), borderColor: '#06b6d4', stepped: true }
                ]
              }}
              options={{ responsive: true, maintainAspectRatio: false, animation: false }}
            />
          </div>
        </div>

      </div>

      {/* ROW 3: TRACING REAL TIME TABLE */}
      <div className={`p-4 rounded-lg shadow-md ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <h3 className="text-md font-bold mb-3 text-gray-700 dark:text-gray-200">
          Tracing Real time table with connection status, Bandwidth
        </h3>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-300 dark:border-gray-700 text-sm font-semibold">
                <th className="p-3">Status</th>
                <th className="p-3">Bandwidth Rate</th>
                <th className="p-3">Active User</th>
                <th className="p-3">Last Update</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="border-b border-gray-200 dark:border-gray-700/50">
                <td className="p-3 font-bold flex items-center gap-2">
                  {isConnected ? (
                    <>
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                      </span>
                      <span className="text-green-500">Connected</span>
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-3 w-3">
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                      </span>
                      <span className="text-red-500">Disconnected</span>
                    </>
                  )}
                </td>

                <td className="p-3">{bandwidth} Bytes / pkt</td>
                <td className="p-3 font-medium">{user ? user.username : 'Guest (Unknow)'}</td>
                <td className="p-3">{new Date().toLocaleTimeString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// Inital React App.jsx for Dashboard with Socket.IO and Chart.js
// import React, { useState, useEffect } from 'react';
// import io from 'socket.io-client';
// import { Line } from 'react-chartjs-2';
// import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';

// ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// const socket = io('http://localhost:5000');

// export default function Dashboard() {
//   const [darkMode, setDarkMode] = useState(false);
//   const [user, setUser] = useState(null);
//   const [usernameInput, setUsernameInput] = useState('');
//   const [passwordInput, setPasswordInput] = useState('');
//   const [saveInterval, setSaveInterval] = useState('realtime');
  
//   // Realtime Sensor Data
//   const [sensor, setSensor] = useState({
//     voltage: 0, resistance: 0, current: 0, ldr: 0,
//     btn1Raw: 0, btn1Debounced: 0, btn2Raw: 0, btn2Debounced: 0
//   });

//   // Chart History
//   const [analogHistory, setAnalogHistory] = useState([]);
//   const [digitalHistory, setDigitalHistory] = useState([]);
//   const [bandwidth, setBandwidth] = useState(0);

//   useEffect(() => {
//     socket.on('dashboard_update', (data) => {
//       setSensor(data);
//       const timeStr = new Date().toLocaleTimeString();

//       // Bandwidth calculation (approx byte size)
//       setBandwidth(JSON.stringify(data).length);

//       setAnalogHistory(prev => [...prev.slice(-19), { time: timeStr, ldr: data.ldr, v: data.voltage, r: data.resistance, i: data.current }]);
//       setDigitalHistory(prev => [...prev.slice(-19), { time: timeStr, b1Raw: data.btn1Raw, b1Clean: data.btn1Debounced, b2Raw: data.btn2Raw, b2Clean: data.btn2Debounced }]);
//     });

//     return () => socket.off('dashboard_update');
//   }, []);

//   const handleLogin = async () => {
//     const res = await fetch('http://localhost:5000/api/login', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ username: usernameInput, password: passwordInput })
//     });
//     const data = await res.json();
//     if (data.token) {
//       setUser(data);
//       localStorage.setItem('token', data.token);
//     } else {
//       alert('Login Failed');
//     }
//   };

//   const handleDownloadCSV = () => {
//     const token = localStorage.getItem('token');
//     window.open(`http://localhost:5000/api/download-csv?token=${token}`, '_blank');
//   };

//   return (
//     <div className={`min-h-screen p-4 ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}>
//       {/* Header Bar */}
//       <div className="flex justify-between items-center mb-4 bg-white dark:bg-gray-800 p-4 rounded shadow">
//         <h1 className="text-xl font-bold">My Dashboard</h1>
//         <div className="flex items-center gap-4">
//           <button onClick={() => setDarkMode(!darkMode)} className="p-2 border rounded">
//             {darkMode ? '☀️ Light' : '🌙 Dark'}
//           </button>
//           <button onClick={handleDownloadCSV} className="p-2 bg-blue-500 text-white rounded">📥 Download CSV</button>
          
//           {/* Settings */}
//           <select value={saveInterval} onChange={(e) => setSaveInterval(e.target.value)} className="p-2 border rounded text-black">
//             <option value="realtime">Save: Realtime</option>
//             <option value="10s">Save: 10s</option>
//             <option value="5m">Save: 5m</option>
//             <option value="1h">Save: 1h</option>
//           </select>

//           {/* Login Status */}
//           {user ? (
//             <span className="text-green-500 font-bold">👤 {user.username}</span>
//           ) : (
//             <div className="flex gap-2">
//               <input type="text" placeholder="User" value={usernameInput} onChange={e=>setUsernameInput(e.target.value)} className="p-1 border rounded text-black w-24"/>
//               <input type="password" placeholder="Pass" value={passwordInput} onChange={e=>setPasswordInput(e.target.value)} className="p-1 border rounded text-black w-24"/>
//               <button onClick={handleLogin} className="p-1 bg-green-500 text-white rounded">Login</button>
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Grid Layoutตามภาพ (3 Rows) */}
//       <div className="grid grid-cols-12 gap-4">
//         {/* Row 1: Gauges & LEDs */}
//         <div className="col-span-4 bg-white dark:bg-gray-800 p-4 rounded shadow text-center">
//           <h3 className="font-bold">Voltage Gauge</h3>
//           <div className="text-4xl font-extrabold my-4 text-blue-500">{sensor.voltage.toFixed(2)} V</div>
//         </div>

//         <div className="col-span-4 bg-white dark:bg-gray-800 p-4 rounded shadow text-center">
//           <h3 className="font-bold">Resistance Gauge</h3>
//           <div className="text-4xl font-extrabold my-4 text-purple-500">{sensor.resistance.toFixed(0)} Ω</div>
//         </div>

//         <div className="col-span-2 bg-white dark:bg-gray-800 p-4 rounded shadow flex flex-col items-center justify-center">
//           <span className="font-bold mb-2">RED LED (Btn 1)</span>
//           <div className={`w-12 h-12 rounded-full ${sensor.btn1Debounced ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-gray-400'}`}></div>
//         </div>

//         <div className="col-span-2 bg-white dark:bg-gray-800 p-4 rounded shadow flex flex-col items-center justify-center">
//           <span className="font-bold mb-2">GREEN LED (Btn 2)</span>
//           <div className={`w-12 h-12 rounded-full ${sensor.btn2Debounced ? 'bg-green-500 shadow-lg shadow-green-500/50' : 'bg-gray-400'}`}></div>
//         </div>

//         {/* Value Sub-bar */}
//         <div className="col-span-4 bg-gray-200 dark:bg-gray-700 p-2 text-center font-semibold rounded">Current Gauge: {sensor.current.toFixed(2)} mA</div>
//         <div className="col-span-8 bg-gray-200 dark:bg-gray-700 p-2 text-center font-semibold rounded">Potentiostat Status: Active</div>

//         {/* Row 2: Analog Graph & Digital Line Graph */}
//         <div className="col-span-6 bg-white dark:bg-gray-800 p-4 rounded shadow">
//           <h3 className="font-bold mb-2">Analog Line Graph (LDR & Sensors)</h3>
//           <Line data={{
//             labels: analogHistory.map(h => h.time),
//             datasets: [
//               { label: 'LDR', data: analogHistory.map(h => h.ldr), borderColor: 'rgb(255, 205, 86)' },
//               { label: 'Voltage', data: analogHistory.map(h => h.v), borderColor: 'rgb(54, 162, 235)' }
//             ]
//           }} options={{ responsive: true, animation: false }} />
//         </div>

//         <div className="col-span-6 bg-white dark:bg-gray-800 p-4 rounded shadow">
//           <h3 className="font-bold mb-2">Digital Line Graph (Raw Noise vs Debounced)</h3>
//           <Line data={{
//             labels: digitalHistory.map(h => h.time),
//             datasets: [
//               { label: 'Btn1 Raw (Noise)', data: digitalHistory.map(h => h.b1Raw), borderColor: 'rgb(255, 99, 132)', stepped: true },
//               { label: 'Btn1 Clean', data: digitalHistory.map(h => h.b1Clean), borderColor: 'rgb(75, 192, 192)', stepped: true },
//               { label: 'Btn2 Raw (Noise)', data: digitalHistory.map(h => h.b2Raw), borderColor: '#f97316', stepped: true },
//               { label: 'Btn2 Debounced (Clean)', data: digitalHistory.map(h => h.b2Clean), borderColor: '#06b6d4', stepped: true }
//             ]
//           }} options={{ responsive: true, animation: false }} />
//         </div>

//         {/* Row 3: Connection Status & Bandwidth Table */}
//         <div className="col-span-12 bg-white dark:bg-gray-800 p-4 rounded shadow">
//           <h3 className="font-bold mb-2">Tracing Real time table with Connection Status</h3>
//           <table className="w-full text-left border-collapse">
//             <thead>
//               <tr className="border-b dark:border-gray-700">
//                 <th className="p-2">Status</th>
//                 <th className="p-2">Bandwidth Rate</th>
//                 <th className="p-2">Active User</th>
//                 <th className="p-2">Last Update</th>
//               </tr>
//             </thead>
//             <tbody>
//               <tr>
//                 <td className="p-2 text-green-500 font-bold">🟢 Connected</td>
//                 <td className="p-2">{bandwidth} Bytes / pkt</td>
//                 <td className="p-2">{user ? user.username : 'Guest'}</td>
//                 <td className="p-2">{new Date().toLocaleTimeString()}</td>
//               </tr>
//             </tbody>
//           </table>
//         </div>
//       </div>
//     </div>
//   );
// }