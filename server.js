const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 4개 은행 기본 대기열 및 상담사 목록 초기화
const queues = {
    "우리은행": { current: 0, nextNumber: 1, waiting: [], staff: ["상담사 1팀"] },
    "신한은행": { current: 0, nextNumber: 1, waiting: [], staff: ["상담사 A"] },
    "국민은행": { current: 0, nextNumber: 1, waiting: [], staff: ["본점 상담사"] },
    "푸본현대생명": { current: 0, nextNumber: 1, waiting: [], staff: ["생명보험 상담사"] }
};

io.on('connection', (socket) => {
    // 1. 대기표 발급 (고객용)
    socket.on('issue_ticket', (data, callback) => {
        const bank = data.bank;
        if (!queues[bank]) return callback({ success: false, message: '존재하지 않는 은행입니다.' });
        
        const ticketNo = queues[bank].nextNumber++;
        queues[bank].waiting.push(ticketNo);
        
        callback({ success: true, ticketNo });
        
        io.emit('queue_update', {
            bank,
            currentServing: queues[bank].current,
            waiting: queues[bank].waiting,
            staff: queues[bank].staff
        });
    });

    // 2. 순번 미루기 (최대 3회 제한은 프론트에서 제어, 대기열 맨 뒤로 이동)
    socket.on('delay_ticket', (data, callback) => {
        const { bank, ticketNo } = data;
        if (!queues[bank]) return callback({ success: false });

        const index = queues[bank].waiting.indexOf(ticketNo);
        if (index > -1) {
            queues[bank].waiting.splice(index, 1);
            queues[bank].waiting.push(ticketNo);
            
            io.emit('queue_update', {
                bank,
                currentServing: queues[bank].current,
                waiting: queues[bank].waiting,
                staff: queues[bank].staff
            });
            callback({ success: true });
        } else {
            callback({ success: false, message: '대기열 정보를 찾을 수 없습니다.' });
        }
    });

    // 3. 다음 고객 호출 (상담사용)
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
            waiting: queues[bank].waiting,
            staff: queues[bank].staff
        });

        callback({ success: true, nextNum });
    });

    // 4. 관리자: 상담사 추가 기능
    socket.on('add_staff', (data, callback) => {
        const { bank, staffName } = data;
        if (!queues[bank]) return callback({ success: false, message: '존재하지 않는 은행입니다.' });
        
        if (!queues[bank].staff.includes(staffName)) {
            queues[bank].staff.push(staffName);
        }

        io.emit('queue_update', {
            bank,
            currentServing: queues[bank].current,
            waiting: queues[bank].waiting,
            staff: queues[bank].staff
        });

        callback({ success: true, staffList: queues[bank].staff });
    });

    // 상태 동기화
    socket.on('get_queue_status', (data) => {
        const bank = data.bank;
        if (queues[bank]) {
            socket.emit('queue_update', {
                bank,
                currentServing: queues[bank].current,
                waiting: queues[bank].waiting,
                staff: queues[bank].staff
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});