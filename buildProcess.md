# MERN Dashoboard with ESP32-S3 DevKitC1

Objective : ทำ Dashboard ที่มี Layout ตามรูป โดยใช้ MERN 

1 สร้าง Main Project folder : MERN_with_ESP32-S3_Tempalte
2 สร้าง Project Folder ย่อยเป็น backend, frontend, controller
3 สอนการ Setup Tools แต่ละส่วนทั้ง Backend, Frontend, controller
Frontend part
4 รับค่าจาก potentiostate 10k และแสดงผลใน Voltage guage, Resistance guage, Current guage
5 รับค่า LDR มาแสดงผล บน Analog Line graph 
6 รับค่าจาก Push Button 2 ปุ่ม ในการแสดงผลบน Digital line graph โดยเก็บค่า Noise และ Debounce ค่าในกราฟด้วย
7 แสดงค่าการกดปุ่ม Show บน Lamp RED and Lamp GREEN บน Layout
8 แสดงสถานะการเชื่อมต่อสัญญาณ และ bandwidth แบบ real time
9 Light/Dark mode ตั้งค่าโหมด มืด/สว่าง
10 Download ใช้สำหรับ Download ค่าจาก Backend เป็นไฟล์ .csv ที่เก็บค่าของแต่ละกราฟ เป็นตาราง
11 Setting ใช้เลือกว่าจะให้เก็บค่าลง Backend แบบ Real time หรือ ทุก 10 วินาที 5 นาที หรือ 1ชม และเลือกลบค่าที่เก็บได้
12 Login ใช้ Show สถานะการ Login และ การเก็บค่าจาก User แต่ละ User โดยต้องมีหน้าลงทะเบียน ด้วย Username และ Password ก่อนและบรรทึกค่าจากทุกข้อมูลให้เชื่อมโยงกับ User นั้นๆ
13 สอนการเลือกกราฟแต่ละกราฟ และการ Setup graph
    Backend part
14 Backend ทำหน้าที่เก็บค่าบอร์ดโดยอ้างอิงการบรรทึกค่าจาก User ที่ลงทะเบียนแล้ว และอยู่ในสถานะ Login 
    Controller
15 บอร์ดที่ใช้เป็น ESP32-S3 DevKitC1 โดยเลือก pin ที่ต้องการใช้
16 สอนการ Wiring บนบอร์ด ที่ทำให้สัญญาณเสถียร และลดการเกิด Noise หรือสัญญาณรบกวน
    Editor
17 เครื่องมือที่ใช้เขียน เป็น VSCode ที่มี ESP-IDF เป็น Extension ของบอร์ดครับ

## Project Structure

MERN_with_ESP32-S3_Tempalte/
├── backend/                  # Node.js + Express + MongoDB + Socket.io (ข้อ 14)
│   ├── config/               # Database connection
│   ├── controllers/          # Auth, Data Logging & CSV Export Logic (ข้อ 10, 11, 14)
│   ├── models/               # User, SensorData & Settings Schemas (ข้อ 12, 14)
│   ├── routes/               # REST APIs & Auth endpoints (ข้อ 12)
│   └── server.js             # Socket.io connection & real-time handler (ข้อ 8)
├── frontend/                 # React.js + Tailwind CSS + Chart.js / Recharts
│   ├── src/
│   │   ├── components/       # Voltage, Resistance, Current Gauges (ข้อ 4)
│   │   │                     # Analog Line Graph (LDR) (ข้อ 5)
│   │   │                     # Digital Line Graph with Noise/Debounce trace (ข้อ 6)
│   │   │                     # Lamp RED & Lamp GREEN Status (ข้อ 7)
│   │   │                     # Bandwidth & Connection Status Table (ข้อ 8)
│   │   ├── context/          # AuthContext, ThemeContext (Light/Dark mode) (ข้อ 9, 12)
│   │   └── pages/            # Dashboard Layout & Login/Register Page (ข้อ 12)
│   └── package.json
└── controller/               # ESP-IDF Extension Project for VSCode (ข้อ 15, 17)
    ├── main/
    │   ├── CMakeLists.txt
    │   └── main.c            # FreeRTOS tasks (ADC Sampling, Debounce, Wi-Fi WebSocket)
    ├── CMakeLists.txt
    └── sdkconfig

## Shortkey

1) 🟡 📌 Emoji on markdown : windows + .
2) Open ESP-IDF terminal
   1) Open configuration : Ctrl + Shift + P
   2) Select command : ESP-IDF: Open ESP-IDF Terminal
3) Solving "#include library" intellisense alert
   1) Enter command in VSCode : Ctrl + Shift + P
   2) Use command : ESP-IDF: Refresh C/C++ Properties Configuration
   3) Press : Enter
4) Choose compiler "xtensa-esp32s3-elf-gcc"
   1) Enter command in VSCode : Ctrl + Shift + P
   2) Use command : C/C++: Select IntelliSense Configuration...
   3) Select : "ESP-IDF" or Compiler's path "xtensa-esp32s3-elf-gcc"
5) Check package install : npm list express mongoose core and etc
6) Fully clean : idf.py fullclean
7) Reconfigure : idf.py reconfigure
8) Build project : idf.py build

## Setup Tools : Backend-Frontend-Controller

🟢 Backend Setup (Node.js + Express + Socket.io)

1) cd backend
2) npm init -y
3) npm install express mongoose cors dotenv socket.io jsonwebtoken bcryptjs json2csv socket.io
4) npm install -D nodemon
5) Run backend : npm start

Description :
    1) express: Web framework สำหรับสร้าง REST API
    2) mongoose: Library สำหรับเชื่อมต่อและจัดการฐานข้อมูล MongoDB
    3) socket.io: ใช้สำหรับรับ-ส่งข้อมูล Real-time ระหว่าง ESP32, Backend และ Frontend
    4) jsonwebtoken & bcryptjs: ระบบ Authentication และเข้ารหัสรหัสผ่าน
    5) json2csv: แปลงข้อมูลใน MongoDB เป็นไฟล์ CSV สำหรับ Download
    6) cors: อนุญาตให้ Frontend เชื่อมต่อ API ได้
    7) nodemon: Tool สำหรับ Auto-restart server เมื่อมีโค้ดเปลี่ยนแปลง (Dev-dependency)
    8) การใช้ Com port เดียวกับ VSCode สำหรับ Monitor โดยบอร์ด ESP32-S3 ต้องปิดการ Monitor ก่อนแล้วค่อย Run Backend เพื่ออ่านค่าจาก Serial port(UART) ไม่สามารถอ่านพร้อมกันได้

### Adding User form

1) Create models folder in backend
2) Create User.js in models folder
3) Create SenserData.js in models folder
4) Update server.js to support Socket.io, JWT & CSV Export

🔵 Frontend Setup (React.js + Chart.js + Tailwind CSS)

1) cd frontend
<!-- สร้างโปรเจกต์ React (ใช้ Vite หรือ Create React App) -->
1) npx create-react-app .
<!-- ติดตั้ง Libraries เพิ่มเติม -->
1) npm install socket.io-client axios chart.js react-chartjs-2 lucide-react
2) npm install -D tailwindcss postcss autoprefixer
3) ติดตั้ง @tailwindcss/cli เพิ่มเติม (สำหรับ Tailwind v3)
   1) ติดตั้ง @tailwindcss/cli เพิ่มใน devDependencies : npm install -D tailwindcss@3 postcss autoprefixer
   2) สร้างไฟล์ tailwind.config.js และ postcss.config.js : npx tailwindcss init -p
   3) ตั้งค่า Path ใน : tailwind.config.js
   4) นำ Directive ไปแปะที่ไฟล์ CSS หลัก : src/index.css หรือ src/App.css
   5) ไฟล์ index.css ขึ้น intellisense แก้โดย
      1) เปิดแท็บ Extensions ใน VS Code (กด Ctrl + Shift + X)
      2) ค้นหาคำว่า Tailwind CSS IntelliSense (ของ Tailwind Labs)
      3) กด Install
      4) เมื่อติดตั้งเสร็จ ให้กด Ctrl + Shift + P -> พิมพ์ Developer: Reload Window เพื่อรีโหลด VS Code เส้นแดง/เหลืองเตือนจะหายไปทันที
4) Run frontend : npm start

Description :
    1) socket.io-client: เชื่อมต่อ WebSocket กับ Backend
    2) chart.js & react-chartjs-2: วาด กราฟ Analog Line Graph และ Digital Line Graph
    3) lucide-react: ไอคอนสำหรับ UI (Sun/Moon, Download, Setting, Login)

### Update frontend

    MongoDB Cluster : 
    username : devillasu_db_user
    pass : rvg9d3BuN3gBG8Bg
    Url : mongodb+srv://<db_username>:<db_password>@cluster0.pj4ukee.mongodb.net/?appName=Cluster0
    JWT_SECRET = a9f8b2c4e1d3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5

1) Update feature user interface : 4-13

🟡 Library / Components for ESP32-S3(ESP-IDF extension)

    📌 ประเภทที่ 1: Core/Built-in Components (มีมากับ ESP-IDF SDK อยู่แล้ว)

        ► สามารถเรียกใช้ในโค้ด main.c และระบุในไฟล์ main/CMakeLists.txt ได้เลย
        Example :
            #include <stdio.h>
            #include <string.h>
            #include "freertos/FreeRTOS.h"
            #include "freertos/task.h"
            #include "driver/gpio.h"
            #include "esp_adc/adc_oneshot.h"
            #include "esp_log.h"
        ► การระบุใน main/CMakeLists.txt
        Example :
            idf_component_register(
            SRCS "main.c"
            INCLUDE_DIRS "."
            REQUIRES driver esp_adc freertos esp_event esp_netif
        )

    📌 ประเภทที่ 2: Managed Components (Library เสริมภายนอก)
        ► หากต้องการใช้ Library เพิ่มเติม เช่น led_strip
            1) เปิด Terminal ใน VS Code (ย้ายไปที่โฟลเดอร์ controller หรือ Root โปรเจกต์ ESP32)
            2) รันคำสั่งเพิ่ม Dependency: idf.py add-dependency "espressif/led_strip"
            ***(ระบบจะสร้างไฟล์ main/idf_component.yml และดาวน์โหลดไฟล์ลงในโฟลเดอร์ managed_components/ ให้อัตโนมัติ)***
            3) นำชื่อ Component ไปใส่ใน main/CMakeLists.txt
            Example : 
                idf_component_register(
                SRCS "main.c"
                INCLUDE_DIRS "."
                REQUIRES driver esp_adc freertos led_strip
                )
            4) สั่ง Reconfigure / Build โปรเจกต์: idf.py build

## Wiring and Setup Tools : ESP32-S3 MERN Dashboard Setup Guide

### 1. Tools Setup (ข้อ 3, 17)

- **Editor**: VSCode พร้อมติดตั้ง Extension **ESP-IDF** (ข้อ 17)
- **Backend**: Node.js v18+, MongoDB Server
- **Frontend**: React.js + Tailwind CSS

### 2. Wiring Diagram & Noise Reduction Guide (ข้อ 16)

- **Potentiometer 10k**:
  - VCC -> 3.3V
  - GND -> GND
  - Signal -> GPIO1 (ADC1_CH0)
- **LDR Sensor**:
  - ต่อแบบ Voltage Divider ร่วมกับ Resistor 10k
  - Signal -> GPIO2 (ADC1_CH1)
- **Push Buttons**:
  - Terminal 1 -> GPIO4 / GPIO5
  - Terminal 2 -> GND (ใช้ Internal Pull-up)

### เทคนิคการลด Noise และสัญญาณรบกวน (ข้อ 16):

1. **Hardware Filtering**: ต่อ C Decoupling (0.1µF) คร่อมขาสัญญาณ ADC และ GND เพื่อกรอง Noise ความถี่สูง
2. **Software Debouncing**: ตั้งค่าหน่วงเวลา 50ms หลังตรวจจับการกดปุ่มเพื่อตัดสัญญาณรบกวนกดซ้ำ
3. **Grounding**: รวมจุด Star Ground ของ Sensor ทั้งหมดกลับไปที่จุด GND เดียวกันบนบอร์ด ESP32-S3

### Update controller for ADC signal(LDR and Potentiometer) and Software support debounce 

### Run ESP-IDF on VSCode

1) Select ESP-IDF verison : 6.10
2) Select connection type : UART
3) Select com port (Check my computer --> propertiies --> device manager --> port) : port 1
4) Select chip : ESP32S3
   1) When using "Managed "Components" such as : led_strip
   2) Open ESP-IDF terminal : ctrl + shift + p
   3) Command as : ESP-IDF: Open ESP-IDF Terminal
   4) Run Adding special library "led_strip" as : idf.py add-dependency "espressif/led_strip^2.0.0"
   ***Don't forget to delete build folder when it error before setup chip to esp32s3**
   5) When add "led_strip" have to clean build : delete build folder, sdkconfig.old, dependencise.lock
   6) Run command reconfiguration : idf.py reconfigure
   7) Run command build : idf.py build
5) Select connect by : USB by JTAG


## Deploy code Frontend-Backend to Onrender

1) URL Backed onrender : https://iotdashboard-mq5d.onrender.com
2) URL Frontend onrender :https://iotdashboard-frontend.onrender.com

### Setup gitHub

1) Setup name : iotDashboard
2) Get URL : https://github.com/Bambo0o0o/iotDashboard.git
3) Method to upload file(new)
   1) echo "# iotDashboard" >> README.md
   2) git init
   3) git add .
   4) git commit -m "Init iotDashboard"
   5) git branch -M main
   6) git remote add origin https://github.com/Bambo0o0o/iotDashboard.git
   7) git push -u origin main
4) Push Exist repository
   1) git remote add origin https://github.com/Bambo0o0o/iotDashboard.git
   2) git branch -M main
   3) git push -u origin 
   
5) Preparing Project file frontend and backend
   1) Create .gitignore place on both folder with this detail :
    //Node dependencies (ป้องกันอัปโหลดโฟลเดอร์นี้)
    node_modules/

	// Environment variables (ป้องกันอัปโหลดไฟล์ลับ/รหัสผ่าน)
	.env
	.env.local

	// Build output

	dist/
	build/
### Build main.c for Onrender 

💡 จุดเด่นและการทำงานของโค้ดชุดนี้:
1) ยิง HTTPS ไป Render Direct: กำหนด BACKEND_URL ไปที่ 
	[https://iotdashboard-mq5d.onrender.com/api/sensor]
	(https://iotdashboard-mq5d.onrender.com/api/sensor)[cite: 20]

2) รองรับ HTTPS Certificate: ใช้ esp_crt_bundle_attach ในการยืนยัน Certificate ป้องกันปัญหา SSL Error เมื่อส่งข้อมูลผ่านโปรโตคอล https://

3) RGB LED สถานะระบบ:

	🔴 สีแดง: กำลังเชื่อมต่อ Wi-Fi หรือส่งข้อมูลไม่สำเร็จ

	🔵 สีน้ำเงิน: เชื่อมต่อ Wi-Fi สำเร็จแล้ว

	🟢 สีเขียว: ส่งข้อมูลขึ้น Onrender (HTTP 200 OK) เรียบร้อยแล้ว

### OnRender-backend 
 
 1. Deploy Backend (Node.js + Express + Socket.IO)
	ขั้นตอนที่ 1: สร้าง Web Service
	1) เข้าไปที่ หน้าแดชบอร์ดของ Render กดปุ่ม New + -> เลือก Web Service

	2) เชื่อมต่อกับ GitHub Repository ของคุณ

	3) ตั้งค่าข้อมูลดังนี้:

		Name: my-dashboard-backend (หรือชื่อตามต้องการ)

		Region: เลือก Singapore (ap-southeast-1) เพื่อความรวดเร็วในการรับส่งข้อมูล

		Root Directory: backend (หากไฟล์ server.js และ package.json อยู่นอกสุดให้เว้นว่างไว้)

		Environment: Node

		Build Command: npm install

		Start Command: node server.js

		Instance Type: Free

ขั้นตอนที่ 2: ตั้งค่า Environment Variables (Environment)
	1) เลื่อนลงมาที่หัวข้อ Environment Variables แล้วเพิ่มค่าดังต่อไปนี้:

	2) PORT: 5000 (หรือปล่อยให้ Render กำหนดอัตโนมัติ)

	3) JWT_SECRET: ตั้งรหัสลับสำหรับ_JWT_ที่นี่

	4) MONGO_URI: mongodb+srv://<username>:<password>@cluster.mongodb.net/dashboard_db?retryWrites=true&w=wmajority

	5) SERIAL_PORT: COM1 (หรือปล่อยไว้สำหรับ Fallback)
	
ขั้นตอนที่ 3: บันทึกและสร้าง Service
	1) กด Create Web Service

	2) รอระบบลง Library และ Build จนขึ้นสถานะ Live

	3) คัดลอก URL ของ Backend ที่ Render เจนให้ เช่น: [https://my-dashboard-backend.onrender.com](https://my-dashboard-backend.onrender.com)
	
 ### OnRender-frontend
 
 ก่อนนำ Frontend ขึ้น Render ให้เปลี่ยน URL ของ API และ Socket.IO ในโค้ด App.jsx ให้ชี้ไปยัง Backend บน Render ที่สร้างเสร็จในข้อ 1:
 
	 1) เปิดไฟล์ frontend/src/App.jsx

	 2) เปลี่ยน http://localhost:5000 เป็น URL ของ Render Backend เช่น:
	 
		// เปลี่ยนจาก http://localhost:5000 เป็น URL บน Render
			const BACKEND_URL = 'https://my-dashboard-backend.onrender.com';
			const socket = io(BACKEND_URL);
	 3) ดัน (Push) โค้ดที่อัปเดตแล้วขึ้นไปยัง GitHub

3. Deploy Frontend (React + Vite / CRA)
	ขั้นตอนที่ 1: สร้าง Static Site
	1) ที่หน้าแดชบอร์ดของ Render กดปุ่ม New + -> เลือก Static Site

	2) เลือก GitHub Repository เดียวกัน

	3) ตั้งค่าข้อมูลดังนี้:

		Name: my-dashboard-frontend

		Root Directory: frontend (หากไฟล์ package.json อยู่ในโฟลเดอร์ frontend)

		Build Command: npm run build

		Publish Directory: dist (หากใช้ Vite) หรือ build (หากใช้ Create React App)
	ขั้นตอนที่ 2: ตั้งค่า Rewrite Rules (สำหรับ SPA Single Page Application)
	1) ไปที่เมนู Redirects/Rewrites ในหน้าคลังตั้งค่าของ Frontend บน Render

	2) เพิ่มกฎดังนี้:

		Source: /*

		Destination: /index.html

		Action: Rewrite
		(ช่วยป้องกันปัญหาหน้าเว็บขึ้น 404 Not Found เมื่อมีการ Refresh หรือกดเปลี่ยนเส้นทางในแอป React)

	3) กด Save Changes และรอระบบ Deploy จนขึ้นสถานะ Live
	
	
### Solve Error on Render

Case : ENOENT: no such file or directory, open '/opt/render/project/src/package.json'
Problems is : เกิดจาก Render หาไฟล์ package.json ในหน้าแรกสุด (Root directory) ไม่เจอ 
	เนื่องจากโครงสร้างโฟลเดอร์ใน GitHub ของคุณแยกโฟลเดอร์ไว้เป็น backend และ frontend ทำให้ Render มองหาไฟล์ตั้งต้นไม่เจอ

🛠️ Solving
	1) เข้าไปที่หน้า Dashboard ของ Render
	2) คลิกเลือก Service Backend (หรือ Frontend) ที่กำลังขึ้น Error อยู่
	3) ไปที่เมนู Settings ด้านซ้ายมือ
	4) เลื่อนลงมาหาหัวข้อ Root Directory
	5) กด Edit แล้วพิมพ์ใส่ชื่อโฟลเดอร์ให้ตรงกับโค้ดของคุณ:
		- กรณีเป็น Web Service (Backend): ใส่ว่า backend
		- กรณีเป็น Static Site (Frontend): ใส่ว่า frontend
	6) กด Save Changes
	7) เมื่อกดบันทึกแล้ว ให้ไปที่มุมขวาบนกด Manual Deploy -> Clear build cache & deploy อีกครั้ง ระบบจะเข้าไปรัน npm install ในโฟลเดอร์ถูกต้องและ Deploy ได้สำเร็จ