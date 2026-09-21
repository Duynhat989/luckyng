const path = require('path')
const http = require('http')
const express = require('express')
const fs = require('fs');

const bodyParser = require('body-parser')
const cors = require('cors')

const { connectDB } = require('./app/config/config');
connectDB();
// Khai báo app
const app = express();
const server = http.createServer(app);
// Mở công giao tiếp công khai
app.use(express.static(path.join(__dirname, 'public')));

// Đường dẫn thư mục storages
const storagePath = path.join(__dirname, 'storages');
// Kiểm tra và tạo nếu chưa tồn tại
if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}
// Serve static files
app.use('/storages', cors({ origin: '*' }), express.static(storagePath));
// Xử lý nếu file trong /storages không tồn tại
app.use('/storages', (req, res) => {
  res.status(404).send('File not found in storages.');
});

app.use(cors({
  origin: '*', // Cho phép tất cả domain
  exposedHeaders: ['X-Encrypted', 'x-encrypted'] // Nếu muốn client đọc được header tuỳ chỉnh
}))
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Khai báo middleware
const decryptMiddleware = require('./app/middlewares/decryptMiddleware.js')
const encryptResponseMiddleware = require('./app/middlewares/encryptResponseMiddleware.js')
app.use(decryptMiddleware);
app.use(encryptResponseMiddleware);
// Khái báo đăng ký routes


// 
const initSocket = require('./app/sockets/index');
const io = initSocket(server);


const initSSE = require('./app/serverSSE/index');
const sse = initSSE(app)
// Truyền `io` vào các request để controller có thể dùng
app.use((req, res, next) => {
  req.io = io;
  req.sse = sse
  next();
});

const {
  authRoutes,
  botRoutes,
  chatRoutes,
  userRoutes,
  messageRoutes,
  storyRoutes,
  owRoutes,
  mediaRoutes,
  mailRouter
} = require('./app/routes');
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/idea', storyRoutes);
app.use('/api/mail', mailRouter);
app.use('/api/media', mediaRoutes);


app.use('/api/bot-onews', owRoutes);


// req.io.notifyNewMessage(roomId, message);

const PORT = 2053;
server.listen(PORT, () => console.log(`Listen: ${PORT}`));

