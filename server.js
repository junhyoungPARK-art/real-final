require('dotenv').config(); // .env 파일에서 환경 변수 로드
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // CORS 미들웨어 추가

const app = express();
const port = process.env.PORT || 3000; // 환경 변수에서 포트 가져오기

// 미들웨어 설정
// CORS 설정: 모든 Origin 허용 (개발 단계에서만 사용 권장)
// 실제 배포 시에는 특정 프론트엔드 도메인만 허용하도록 변경하는 것이 좋습니다.
// 예시:
/*
const allowedOrigins = [
    'https://your-vercel-frontend-url.vercel.app', // Vercel에 배포된 프론트엔드 URL
    'http://localhost:5500', // 로컬 개발용 (VS Code Live Server 등)
    'http://localhost:3000' // 로컬 개발용 (프론트엔드도 로컬에서 실행 시)
];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
*/
app.use(cors()); // 현재는 모든 Origin 허용 상태 유지

app.use(express.json()); // JSON 형식의 요청 본문 파싱

// --- MongoDB 연결 ---
const mongoURI = process.env.MONGO_URI; // .env 파일에서 MongoDB URI 가져오기

if (!mongoURI) {
    console.error('환경 변수 MONGO_URI가 설정되지 않았습니다. .env 파일을 확인해주세요.');
    process.exit(1); // MONGO_URI가 없으면 서버 종료
}

mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB에 성공적으로 연결되었습니다.'))
    .catch(err => {
        console.error('MongoDB 연결 오류:', err);
        process.exit(1); // 연결 실패 시 서버 종료
    });

// --- Mongoose 스키마 및 모델 정의 ---

// 메시지 스키마
const messageSchema = new mongoose.Schema({
    author: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: String, default: () => new Date().toLocaleString() }
});

// 배우 스키마 (각 배우가 메시지 배열을 가짐)
const actorSchema = new mongoose.Schema({
    id: { type: Number, required: true }, // 클라이언트에서 사용하는 숫자 ID
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

// 1. 초기 데이터 저장 (클라이언트에서 한 번만 호출하여 DB에 데이터 주입)
// 프론트엔드에서 { actors: defaultActorsData } 형태로 보내므로 req.body.actors를 사용
app.post('/api/init-data', async (req, res) => {
    try {
        // 클라이언트에서 { actors: { '날짜': [...] } } 형태로 보내므로 req.body.actors를 사용
        const { actors: defaultActorsData } = req.body; 

        if (!defaultActorsData) {
            return res.status(400).send('Invalid data format. Expected { "actors": { "YYYY-MM-DD": [...] } }');
        }

        for (const dateKey in defaultActorsData) {
            const actorsForDate = defaultActorsData[dateKey];
            if (!Array.isArray(actorsForDate)) {
                console.warn(`Skipping invalid actors data for dateKey: ${dateKey}`);
                continue;
            }

            const dateEntry = await DateData.findOneAndUpdate(
                { date: dateKey },
                { $set: { actors: actorsForDate } }, // $set을 사용하여 기존 배우 데이터를 덮어씀
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

// 2. 모든 날짜의 배우 데이터 가져오기 (프론트엔드의 loadActors() 함수와 연결)
// 이 라우트가 있어야 프론트엔드의 loadActors()가 정상 작동합니다.
app.get('/api/actors', async (req, res) => {
    try {
        const allDateData = await DateData.find({});
        const groupedActors = {};
        allDateData.forEach(entry => {
            groupedActors[entry.date] = entry.actors;
        });
        res.status(200).json(groupedActors);
    } catch (error) {
        console.error('모든 배우 데이터 가져오기 실패:', error);
        res.status(500).send({ message: '서버 오류로 모든 배우 데이터를 가져올 수 없습니다.' });
    }
});

// 3. 특정 날짜의 배우 데이터 가져오기 (기존 라우트 유지)
app.get('/api/actors/:date', async (req, res) => {
    try {
        const date = req.params.date;
        const dateData = await DateData.findOne({ date: date });
        if (!dateData) {
            // 해당 날짜의 데이터가 없을 경우 404 대신 빈 배열 반환 (프론트엔드 처리 용이)
            return res.status(200).json([]); 
        }
        res.status(200).json(dateData.actors);
    } catch (error) {
        console.error('특정 날짜 배우 데이터 가져오기 실패:', error);
        res.status(500).send({ message: '서버 오류로 배우 데이터를 가져올 수 없습니다.' });
    }
});

// 4. 특정 배우의 메시지 가져오기 (프론트엔드의 loadMessagesForActor() 함수와 연결)
// actorId는 숫자 ID이고, 날짜는 쿼리 파라미터로 받습니다.
app.get('/api/actors/:actorId/messages', async (req, res) => {
    try {
        const actorId = parseInt(req.params.actorId); // 숫자 ID로 파싱
        const date = req.query.date; // 쿼리 파라미터로 날짜 받기

        if (isNaN(actorId) || !date) {
            return res.status(400).send({ message: '유효한 배우 ID와 날짜가 필요합니다.' });
        }

        const dateData = await DateData.findOne({ date: date });
        if (!dateData) {
            return res.status(404).send({ message: '해당 날짜의 배우 데이터를 찾을 수 없습니다.' });
        }

        // dateData.actors 배열에서 id 필드를 사용하여 배우 찾기
        const actor = dateData.actors.find(a => a.id === actorId); 

        if (!actor) {
            return res.status(404).send({ message: '해당 배우를 찾을 수 없습니다.' });
        }
        res.status(200).json(actor.messages); // 해당 배우의 메시지만 반환
    } catch (error) {
        console.error('메시지 가져오기 실패:', error);
        res.status(500).send({ message: '서버 오류로 메시지를 가져올 수 없습니다.' });
    }
});

// 5. 특정 배우에게 메시지 추가 (프론트엔드의 sendMessage() 함수와 연결)
// actorId는 숫자 ID이고, 날짜는 요청 본문에서 받습니다.
app.post('/api/actors/:actorId/messages', async (req, res) => {
    try {
        const actorId = parseInt(req.params.actorId); // 숫자 ID로 파싱
        const { author, text, date } = req.body; // 날짜를 본문에서 받음

        if (isNaN(actorId) || !author || !text || !date) {
            return res.status(400).send({ message: '유효한 배우 ID, 작성자 이름, 메시지 내용, 날짜가 필요합니다.' });
        }

        const dateData = await DateData.findOne({ date: date });
        if (!dateData) {
            return res.status(404).send({ message: '해당 날짜의 배우 데이터가 없습니다.' });
        }

        // dateData.actors 배열에서 id 필드를 사용하여 배우 찾기
        const actor = dateData.actors.find(a => a.id === actorId); 
        if (!actor) {
            return res.status(404).send({ message: '해당 배우를 찾을 수 없습니다.' });
        }

        const newMessage = {
            author,
            text,
            timestamp: new Date().toLocaleString()
        };

        actor.messages.push(newMessage);
        await dateData.save(); // 변경사항 저장

        // 업데이트된 배우 객체와 메시지 배열을 반환 (프론트엔드에서 활용)
        res.status(201).json(actor); 
    } catch (error) {
        console.error('메시지 추가 실패:', error);
        res.status(500).send({ message: '서버 오류로 메시지를 추가할 수 없습니다.' });
    }
});

// 서버 시작
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});