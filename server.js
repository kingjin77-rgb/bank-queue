const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 은행별 대기열 및 번호 관리
const queues = {
    "우리은행": { current: 0, nextNumber: 1, waiting: [] },
    "신한은행": { current: 0, nextNumber: 1, waiting: [] },
    "국민은행": { current: 0, nextNumber: 1, waiting: [] },
    "푸본현대생명": { current: 0, nextNumber: 1, waiting: [] }
};

io.on('connection', (socket) => {
    // 대기표 발급
    socket.on('issue_ticket', (data, callback) => {
        const bank = data.bank;
        if (!queues[bank]) {
            return callback({ success: false, message: '존재하지 않는 은행입니다.' });
        }
        
        const ticketNo = queues[bank].nextNumber++;
        queues[bank].waiting.push(ticketNo);
        
        callback({ success: true, ticketNo });
        
        // 실시간 갱신 브로드캐스트
        io.emit('queue_update', {
            bank,
            currentServing: queues[bank].current,
            waiting: queues[bank].waiting
        });
    });

    // 순번 미루기 (대기열 맨 뒤로 이동)
    socket.on('delay_ticket', (data, callback) => {
        const { bank, ticketNo } = data;
        if (!queues[bank]) return callback({ success: false });

        const index = queues[bank].waiting.indexOf(ticketNo);
        if (index > -1) {
            queues[bank].waiting.splice(index, 1);
            queues[bank].waiting.push(ticketNo); // 맨 뒤로 재배치
            
            io.emit('queue_update', {
                bank,
                currentServing: queues[bank].current,
                waiting: queues[bank].waiting
            });
            callback({ success: true });
        } else {
            callback({ success: false, message: '대기열 정보를 찾을 수 없습니다.' });
        }
    });

    // 상담사의 다음 고객 호출
    socket.on('call_next', (data, callback) => {
        const { bank } = data;
        if (!queues[bank]) return callback({ success: false });

        if (queues[bank].waiting.length === 0) {
            return callback({ success: false, message: '대기 중인 고객이 없습니다.' });
        }

        const nextNum = queues[bank].waiting.shift();
        queues[bank].current = nextNum;

        io.emit('queue_update', {
            bank,
            currentServing: queues[bank].current,
            waiting: queues[bank].waiting
        });

        callback({ success: true, nextNum });
    });

    // 현재 상태 동기화 요청
    socket.on('get_queue_status', (data) => {
        const bank = data.bank;
        if (queues[bank]) {
            socket.emit('queue_update', {
                bank,
                currentServing: queues[bank].current,
                waiting: queues[bank].waiting
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});