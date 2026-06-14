// 数据库配置
const DB_NAME = 'WordMemoDB';
const DB_VERSION = 1;
const STORE_WORDS = 'words';
const STORE_PROGRESS = 'progress';

let db = null;
let currentWord = null;
let currentMode = 'review'; // review 或 learn

// 艾宾浩斯遗忘曲线间隔（分钟）- 调整为更合理的间隔
const EBINGHAUS_INTERVALS = [1, 5, 30, 12 * 60, 24 * 60, 2 * 24 * 60, 4 * 24 * 60, 7 * 24 * 60, 15 * 24 * 60];

// 默认词库（四级核心词）
const DEFAULT_WORDS = [
    { word: 'abandon', phonetic: '/əˈbændən/', meaning: 'v. 放弃，遗弃', example: 'He abandoned his car and ran for help.' },
    { word: 'ability', phonetic: '/əˈbɪləti/', meaning: 'n. 能力，才能', example: 'She has the ability to solve complex problems.' },
    { word: 'absence', phonetic: '/ˈæbsəns/', meaning: 'n. 缺席，缺乏', example: 'His absence from school was noticed by the teacher.' },
    { word: 'absolute', phonetic: '/ˈæbsəluːt/', meaning: 'adj. 绝对的，完全的', example: 'I have absolute confidence in your ability.' },
    { word: 'absorb', phonetic: '/əbˈzɔːrb/', meaning: 'v. 吸收，吸引', example: 'Plants absorb carbon dioxide from the air.' },
    { word: 'abstract', phonetic: '/ˈæbstrækt/', meaning: 'adj. 抽象的 n. 摘要', example: 'The painting is completely abstract.' },
    { word: 'abundant', phonetic: '/əˈbʌndənt/', meaning: 'adj. 丰富的，充裕的', example: 'The region is abundant in wildlife.' },
    { word: 'academic', phonetic: '/ˌækəˈdemɪk/', meaning: 'adj. 学术的，学院的', example: 'She has excellent academic records.' },
    { word: 'academy', phonetic: '/əˈkædəmi/', meaning: 'n. 学院，研究院', example: 'He graduated from a military academy.' },
    { word: 'accelerate', phonetic: '/əkˈseləreɪt/', meaning: 'v. 加速，促进', example: 'The car accelerated down the slope.' },
    { word: 'accent', phonetic: '/ˈæksent/', meaning: 'n. 口音，重音', example: 'She spoke with a strong French accent.' },
    { word: 'accept', phonetic: '/əkˈsept/', meaning: 'v. 接受，认可', example: 'I accept your apology.' },
    { word: 'access', phonetic: '/ˈækses/', meaning: 'n. 通道，入口 v. 接近', example: 'Students have access to the library.' },
    { word: 'accident', phonetic: '/ˈæksɪdənt/', meaning: 'n. 事故，意外', example: 'He had a car accident yesterday.' },
    { word: 'accompany', phonetic: '/əˈkʌmpəni/', meaning: 'v. 陪伴，伴随', example: 'She accompanied me to the hospital.' },
    { word: 'accomplish', phonetic: '/əˈkʌmplɪʃ/', meaning: 'v. 完成，实现', example: 'We accomplished the task ahead of schedule.' },
    { word: 'accord', phonetic: '/əˈkɔːrd/', meaning: 'v. 一致，符合 n. 协议', example: 'His views are in accord with mine.' },
    { word: 'account', phonetic: '/əˈkaʊnt/', meaning: 'n. 账户，解释 v. 说明', example: 'I opened a bank account yesterday.' },
    { word: 'accumulate', phonetic: '/əˈkjuːmjəleɪt/', meaning: 'v. 积累，堆积', example: 'Dust began to accumulate on the shelves.' },
    { word: 'accurate', phonetic: '/ˈækjərət/', meaning: 'adj. 精确的，准确的', example: 'The report is accurate and well-researched.' }
];

// 初始化数据库
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // 单词表
            if (!database.objectStoreNames.contains(STORE_WORDS)) {
                const wordStore = database.createObjectStore(STORE_WORDS, { keyPath: 'id', autoIncrement: true });
                wordStore.createIndex('word', 'word', { unique: true });
            }
            
            // 学习进度表
            if (!database.objectStoreNames.contains(STORE_PROGRESS)) {
                const progressStore = database.createObjectStore(STORE_PROGRESS, { keyPath: 'wordId' });
                progressStore.createIndex('nextReview', 'nextReview', { unique: false });
                progressStore.createIndex('stage', 'stage', { unique: false });
            }
        };
    });
}

// 添加单词
async function addWord(wordData) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_WORDS, STORE_PROGRESS], 'readwrite');
        const wordStore = transaction.objectStore(STORE_WORDS);
        const progressStore = transaction.objectStore(STORE_PROGRESS);
        
        // 先检查是否已存在
        const index = wordStore.index('word');
        const request = index.get(wordData.word);
        
        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result.id); // 已存在，返回ID
                return;
            }
            
            // 添加新单词
            const addRequest = wordStore.add(wordData);
            addRequest.onsuccess = () => {
                const wordId = addRequest.result;
                // 初始化学习进度
                progressStore.add({
                    wordId: wordId,
                    stage: 0,
                    nextReview: Date.now(),
                    reviewCount: 0,
                    correctCount: 0,
                    lastReview: null,
                    addedAt: Date.now()
                });
                resolve(wordId);
            };
            addRequest.onerror = () => reject(addRequest.error);
        };
    });
}

// 获取今日待复习单词
async function getTodayReviewWords() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_PROGRESS, STORE_WORDS], 'readonly');
        const progressStore = transaction.objectStore(STORE_PROGRESS);
        const wordStore = transaction.objectStore(STORE_WORDS);
        
        const words = [];
        const now = Date.now();
        const index = progressStore.index('nextReview');
        const range = IDBKeyRange.upperBound(now);
        const request = index.openCursor(range);
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const progress = cursor.value;
                // 获取单词详情
                const wordRequest = wordStore.get(progress.wordId);
                wordRequest.onsuccess = () => {
                    if (wordRequest.result) {
                        words.push({
                            ...wordRequest.result,
                            progress: progress
                        });
                    }
                };
                cursor.continue();
            } else {
                resolve(words);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

// 获取新词（未开始学习的）
async function getNewWords(limit = 10) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_PROGRESS, STORE_WORDS], 'readonly');
        const progressStore = transaction.objectStore(STORE_PROGRESS);
        const wordStore = transaction.objectStore(STORE_WORDS);
        
        const words = [];
        const request = progressStore.openCursor();
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && words.length < limit) {
                const progress = cursor.value;
                if (progress.stage === 0 && progress.reviewCount === 0) {
                    const wordRequest = wordStore.get(progress.wordId);
                    wordRequest.onsuccess = () => {
                        if (wordRequest.result) {
                            words.push({
                                ...wordRequest.result,
                                progress: progress
                            });
                        }
                    };
                }
                cursor.continue();
            } else {
                resolve(words);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

// 更新学习进度
async function updateProgress(wordId, result) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_PROGRESS], 'readwrite');
        const progressStore = transaction.objectStore(STORE_PROGRESS);
        
        const request = progressStore.get(wordId);
        request.onsuccess = () => {
            const progress = request.result;
            progress.lastReview = Date.now();
            progress.reviewCount++;
            
            if (result === 'correct') {
                progress.correctCount++;
                progress.stage = Math.min(progress.stage + 1, EBINGHAUS_INTERVALS.length - 1);
            } else if (result === 'wrong') {
                progress.stage = Math.max(0, progress.stage - 1);
            }
            // vague 保持当前阶段
            
            // 计算下次复习时间
            const interval = EBINGHAUS_INTERVALS[progress.stage];
            progress.nextReview = Date.now() + interval * 60 * 1000;
            
            progressStore.put(progress);
            resolve(progress);
        };
        request.onerror = () => reject(request.error);
    });
}

// 获取所有单词
async function getAllWords() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_WORDS, STORE_PROGRESS], 'readonly');
        const wordStore = transaction.objectStore(STORE_WORDS);
        const progressStore = transaction.objectStore(STORE_PROGRESS);
        
        const words = [];
        const request = wordStore.openCursor();
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const word = cursor.value;
                const progressRequest = progressStore.get(word.id);
                progressRequest.onsuccess = () => {
                    words.push({
                        ...word,
                        progress: progressRequest.result
                    });
                };
                cursor.continue();
            } else {
                resolve(words);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

// 渲染复习卡片
async function renderReviewCard() {
    const container = document.getElementById('review-card');
    const words = await getTodayReviewWords();
    
    // 更新统计
    document.getElementById('review-count').textContent = words.length;
    
    if (words.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎉</div>
                <p>今日复习已完成！</p>
                <button class="btn btn-primary" onclick="showPage('learn')">去学习新词</button>
            </div>
        `;
        return;
    }
    
    currentWord = words[0];
    currentMode = 'review';
    renderWordCard(container, currentWord);
}

// 渲染学习卡片
async function renderLearnCard() {
    const container = document.getElementById('learn-card');
    const words = await getNewWords(1);
    
    if (words.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">✨</div>
                <p>暂无新词，先导入词库吧</p>
                <button class="btn btn-primary" onclick="importDefaultWords()">导入默认词库</button>
            </div>
        `;
        return;
    }
    
    currentWord = words[0];
    currentMode = 'learn';
    renderWordCard(container, currentWord);
}

// 渲染单词卡片
function renderWordCard(container, word) {
    const template = document.getElementById('word-card-template');
    const clone = template.content.cloneNode(true);
    
    clone.querySelector('.word-text').textContent = word.word;
    clone.querySelector('.word-phonetic').textContent = word.phonetic;
    clone.querySelector('.word-meaning').textContent = word.meaning;
    clone.querySelector('.word-example').textContent = word.example || '';
    
    const card = clone.querySelector('.word-card');
    
    // 点击翻转
    card.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn')) return;
        card.classList.toggle('flipped');
    });
    
    // 按钮事件
    clone.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const result = btn.dataset.result;
            await updateProgress(word.id, result);
            
            // 加载下一个
            if (currentMode === 'review') {
                renderReviewCard();
            } else {
                renderLearnCard();
            }
        });
    });
    
    container.innerHTML = '';
    container.appendChild(clone);
}

// 渲染词库列表
async function renderWordList() {
    const container = document.getElementById('word-list');
    const words = await getAllWords();
    
    document.getElementById('total-count').textContent = words.length;
    
    if (words.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>词库为空，先导入单词吧</p></div>';
        return;
    }
    
    container.innerHTML = words.map(word => {
        const stage = word.progress?.stage || 0;
        let statusClass = 'status-new';
        let statusText = '新词';
        
        if (stage >= 5) {
            statusClass = 'status-mastered';
            statusText = '已掌握';
        } else if (stage > 0 || word.progress?.reviewCount > 0) {
            statusClass = 'status-learning';
            statusText = '学习中';
        }
        
        return `
            <div class="word-item">
                <div class="word-info">
                    <h4>${word.word}</h4>
                    <p>${word.meaning}</p>
                </div>
                <span class="word-status ${statusClass}">${statusText}</span>
            </div>
        `;
    }).join('');
}

// 导入默认词库
async function importDefaultWords() {
    for (const word of DEFAULT_WORDS) {
        await addWord(word);
    }
    alert(`已导入 ${DEFAULT_WORDS.length} 个单词！`);
    renderReviewCard();
    renderLearnCard();
    renderWordList();
}

// 切换页面
function showPage(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    
    document.getElementById(`page-${pageName}`).classList.add('active');
    document.querySelector(`[data-tab="${pageName}"]`)?.classList.add('active');
    
    if (pageName === 'review') renderReviewCard();
    if (pageName === 'learn') renderLearnCard();
    if (pageName === 'words') renderWordList();
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    
    // 标签切换
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            showPage(tab.dataset.tab);
        });
    });
    
    // 模式切换
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.learn-mode').forEach(m => m.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`mode-${btn.dataset.mode}`).classList.add('active');
        });
    });
    
    // 方法卡片点击
    document.querySelectorAll('.method-card').forEach(card => {
        card.addEventListener('click', () => {
            alert('多方法模式开发中...');
        });
    });
    
    // 初始加载
    renderReviewCard();
});
