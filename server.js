require('dotenv').config(); // .env 파일에서 환경 변수 로드
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // CORS 미들웨어 추가

const app = express();
const port = process.env.PORT || 3000; // 환경 변수에서 포트 가져오기

// 미들웨어 설정
app.use(cors()); // 모든 Origin 허용 (개발 단계에서만 사용 권장)
app.use(express.json()); // JSON 형식의 요청 본문 파싱

// --- MongoDB 연결 ---
const mongoURI = process.env.MONGO_URI; // .env 파일에서 MongoDB URI 가져오기

mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB에 성공적으로 연결되었습니다.'))
    .catch(err => console.error('MongoDB 연결 오류:', err));

// --- Mongoose 스키마 및 모델 정의 ---

// 메시지 스키마
const messageSchema = new mongoose.Schema({
    author: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: String, default: () => new Date().toLocaleString() }
});

// 배우 스키마 (각 배우가 메시지 배열을 가짐)
const actorSchema = new mongoose.Schema({
    id: { type: Number, required: true },
    name: { type: String, required: true },
    role: { type: String, required: true },
    photo: { type: String },
    messages: [messageSchema] // 메시지 스키마를 배열로 포함
});

// 날짜별 배우 데이터 스키마 (특정 날짜에 해당하는 배우 목록)
const dateDataSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // 'YYYY-MM-DD' 형식
    actors: [actorSchema] // 해당 날짜의 배우 배열
});

const DateData = mongoose.model('DateData', dateDataSchema);

// --- API 라우트 ---

// 초기 데이터 저장 (한 번만 실행하거나, 데이터가 없을 때만 실행)
app.post('/api/init-data', async (req, res) => {
    try {
        const defaultActorsData = req.body; // 클라이언트에서 보내는 초기 데이터

        for (const dateKey in defaultActorsData) {
            const dateEntry = await DateData.findOneAndUpdate(
                { date: dateKey },
                { $set: { actors: defaultActorsData[dateKey] } },
                { upsert: true, new: true } // 없으면 새로 만들고, 있으면 업데이트
            );
            console.log(`Date data for ${dateKey} saved/updated.`);
        }
        res.status(200).send('Initial data initialized/updated successfully.');
    } catch (error) {
        console.error('Initial data initialization failed:', error);
        res.status(500).send('Failed to initialize initial data.');
    }
});

// 특정 날짜의 배우 데이터 가져오기
app.get('/api/actors/:date', async (req, res) => {
    try {
        const date = req.params.date;
        const dateData = await DateData.findOne({ date: date });
        if (!dateData) {
            return res.status(404).send({ message: '해당 날짜의 배우 데이터가 없습니다.' });
        }
        res.status(200).json(dateData.actors);
    } catch (error) {
        console.error('배우 데이터 가져오기 실패:', error);
        res.status(500).send({ message: '서버 오류로 배우 데이터를 가져올 수 없습니다.' });
    }
});

// 특정 배우에게 메시지 추가
app.post('/api/actors/:date/:actorId/messages', async (req, res) => {
    try {
        const { date, actorId } = req.params;
        const { author, text } = req.body;

        const newMessage = { author, text };

        const dateData = await DateData.findOne({ date: date });
        if (!dateData) {
            return res.status(404).send({ message: '해당 날짜의 배우 데이터가 없습니다.' });
        }

        const actor = dateData.actors.id(actorId); // Mongoose의 Subdocument ID 쿼리
        if (!actor) {
            return res.status(404).send({ message: '해당 배우를 찾을 수 없습니다.' });
        }

        actor.messages.push(newMessage);
        await dateData.save(); // 변경사항 저장

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('메시지 추가 실패:', error);
        res.status(500).send({ message: '서버 오류로 메시지를 추가할 수 없습니다.' });
    }
});

// 서버 시작
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});