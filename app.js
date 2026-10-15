// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const supabaseConfig = {
    url: "https://bqtwdafpyxjrnkrikaqg.supabase.co",
    key: "sb_publishable_3Rdk0YY-Y1X9g4nUTJPGpg_-oGtDqgw"
};

let supabaseClient = null;
let realtimeChannel = null;

try {
    if (window.supabase && supabaseConfig.url && supabaseConfig.key) {
        supabaseClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.key);
    }
} catch (e) {
    console.log("Supabase cliente en modo local / offline:", e);
}

// Premios oficiales predeterminados
let defaultPrizes = [
    "Descuento 10%", 
    "Descuento 7.5 %", 
    "Descuento 5%", 
    "Rebaja Bs. 50", 
    "Rebaja Bs. 40", 
    "Rebaja Bs. 30", 
    "Rebaja Bs. 20", 
    "Rebaja Bs. 25"
];

// Estado global de la aplicación
let prizes = JSON.parse(localStorage.getItem('lafamilia_prizes')) || defaultPrizes;
let winners = JSON.parse(localStorage.getItem('lafamilia_winners')) || [];
let currentPlayer = { name: '', phone: '' };
let isSpinning = false;
let currentAngle = 0;
let lastWinnerPrize = '';

const sliceColors = ['#2dd4bf', '#34d399', '#10b981', '#059669', '#14b8a6', '#20c997', '#0d9488', '#3ee0b5'];

const canvas = document.getElementById('rouletteCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

// ==========================================
// 1. SINCRONIZACIÓN EN TIEMPO REAL (SUPABASE)
// ==========================================
async function initCloud() {
    updateSyncBadge(supabaseClient ? "Conectando..." : "Modo Local");
    if (!supabaseClient) return;

    try {
        // Cargar premios desde la nube
        const { data: prizeData } = await supabaseClient.from('prizes').select('*').eq('id', 1).single();
        if (prizeData && prizeData.items && Array.isArray(prizeData.items)) {
            prizes = prizeData.items;
            localStorage.setItem('lafamilia_prizes', JSON.stringify(prizes));
            if (!isSpinning) drawRoulette(currentAngle);
        }

        // Cargar ganadores desde la nube
        await fetchCloudWinners();

        // Conectar suscripción Realtime para cualquier celular / equipo simultáneo
        setupRealtimeSubscription();
        updateSyncBadge("En Vivo (Nube)");
    } catch (err) {
        console.log("Sincronizando de forma local:", err);
        updateSyncBadge("Modo Local");
    }
}

async function fetchCloudWinners() {
    if (!supabaseClient) return;
    try {
        const { data: winnerData, error } = await supabaseClient
            .from('winners')
            .select('*')
            .order('id', { ascending: false });

        if (winnerData && !error) {
            winners = winnerData;
            localStorage.setItem('lafamilia_winners', JSON.stringify(winners));
            loadAdminWinnersTable();
        }
    } catch (e) {
        console.error("Error al consultar ganadores en Supabase:", e);
    }
}

function setupRealtimeSubscription() {
    if (!supabaseClient || realtimeChannel) return;
    try {
        realtimeChannel = supabaseClient
            .channel('public_realtime_changes')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'winners' }, (payload) => {
                if (payload.new) {
                    const exists = winners.some(w => (w.id && w.id === payload.new.id) || (w.phone === payload.new.phone && w.date === payload.new.date));
                    if (!exists) {
                        winners.unshift(payload.new);
                        localStorage.setItem('lafamilia_winners', JSON.stringify(winners));
                        loadAdminWinnersTable();
                    }
                }
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'winners' }, () => {
                winners = [];
                localStorage.setItem('lafamilia_winners', JSON.stringify([]));
                loadAdminWinnersTable();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'prizes' }, (payload) => {
                if (payload.new && payload.new.items) {
                    prizes = payload.new.items;
                    localStorage.setItem('lafamilia_prizes', JSON.stringify(prizes));
                    if (!isSpinning) drawRoulette(currentAngle);
                    loadAdminPrizesInputs();
                }
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    updateSyncBadge("En Vivo (Nube)");
                }
            });
    } catch (e) {
        console.error("Error al conectar Realtime:", e);
    }
}

function updateSyncBadge(status) {
    const badge = document.getElementById('cloud-sync-badge');
    if (badge) {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full ${status.includes('Nube') || status.includes('Vivo') ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}"></span> ${status}`;
    }
}

// ==========================================
// VALIDACIÓN DEL FORMULARIO Y TELÉFONO
// ==========================================
const phoneInput = document.getElementById('reg-phone');
const phoneErrorMsg = document.getElementById('phone-error-msg');
const phoneErrorText = document.getElementById('phone-error-text');

function showPhoneError(message) {
    if (phoneErrorMsg && phoneErrorText) {
        phoneErrorText.textContent = message;
        phoneErrorMsg.classList.remove('hidden');
    }
    if (phoneInput) {
        phoneInput.classList.add('border-rose-500', 'focus:border-rose-400');
        phoneInput.classList.remove('border-emerald-500/30', 'focus:border-emerald-400');
    }
}

function hidePhoneError() {
    if (phoneErrorMsg) phoneErrorMsg.classList.add('hidden');
    if (phoneInput) {
        phoneInput.classList.remove('border-rose-500', 'focus:border-rose-400');
        phoneInput.classList.add('border-emerald-500/30', 'focus:border-emerald-400');
    }
}

if (phoneInput) {
    phoneInput.addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').slice(0, 8);
        if (this.value.length === 8) {
            hidePhoneError();
        }
    });
}

const regForm = document.getElementById('form-register');
if (regForm) {
    regForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const rawPhone = document.getElementById('reg-phone').value.trim();
        const phone = rawPhone.replace(/\D/g, '');

        if (!name) return;

        // Restringir a 8 dígitos exactos
        if (phone.length < 8) {
            showPhoneError('falta un dígito verifique');
            return;
        }

        // Restringir a 1 tiro por número (comprobación local)
        const alreadyPlayedLocal = winners.some(w => String(w.phone).replace(/\D/g, '') === phone);
        if (alreadyPlayedLocal) {
            showPhoneError('Este número telefónico ya participó y jugó su tiro permitido.');
            return;
        }

        // Restringir a 1 tiro por número (comprobación en tiempo real en Supabase)
        if (supabaseClient) {
            try {
                const { data } = await supabaseClient.from('winners').select('id, phone').eq('phone', phone).limit(1);
                if (data && data.length > 0) {
                    showPhoneError('Este número telefónico ya participó y jugó su tiro permitido.');
                    return;
                }
            } catch (err) {
                console.log("Validación local fallback");
            }
        }

        hidePhoneError();
        currentPlayer = { name, phone };
        const displayName = document.getElementById('player-display-name');
        if (displayName) displayName.textContent = name;

        document.getElementById('screen-register').classList.add('hidden');
        document.getElementById('screen-game').classList.remove('hidden');
        drawRoulette(currentAngle);
    });
}

// ==========================================
// DIBUJO Y ANIMACIÓN DE LA RULETA
// ==========================================
function drawRoulette(angle = 0) {
    if (!canvas || !ctx) return;
    const numSlices = prizes.length;
    const arc = (2 * Math.PI) / numSlices;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2 - 6;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);

    for (let i = 0; i < numSlices; i++) {
        const startAngle = i * arc;
        const endAngle = (i + 1) * arc;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, startAngle, endAngle);
        ctx.closePath();

        const grad = ctx.createRadialGradient(0, 0, 20, 0, 0, radius);
        grad.addColorStop(0, '#ffffff22');
        grad.addColorStop(1, sliceColors[i % sliceColors.length]);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#ffffff66';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.save();
        const sliceAngle = startAngle + arc / 2;
        ctx.rotate(sliceAngle);
        
        ctx.font = 'bold 13px "Outfit", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        
        ctx.fillStyle = '#ffffff';
        ctx.fillText(prizes[i], radius - 22, 0);
        ctx.restore();
    }
    ctx.restore();
}

function spinWheel() {
    if (isSpinning) return;
    isSpinning = true;
    const spinBtn = document.getElementById('spin-btn');
    if (spinBtn) spinBtn.disabled = true;

    const numSlices = prizes.length;
    const randomSpins = Math.floor(Math.random() * 2) + 3;
    const targetAngle = currentAngle + (randomSpins * 2 * Math.PI) + Math.random() * (2 * Math.PI);
    
    // Duración de giro: 3.3 segundos
    const spinDuration = 3300;
    const startTime = performance.now();

    function animateSpin(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / spinDuration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        
        const currentAnimatedAngle = currentAngle + (targetAngle - currentAngle) * easeProgress;
        drawRoulette(currentAnimatedAngle);

        if (progress < 1) {
            requestAnimationFrame(animateSpin);
        } else {
            // Detención en el ángulo del premio
            currentAngle = targetAngle % (2 * Math.PI);
            drawRoulette(currentAngle);
            isSpinning = false;
            if (spinBtn) spinBtn.disabled = false;

            // Retraso de 2 segundos antes de mostrar el banner de felicitaciones
            setTimeout(() => {
                determineWinner(currentAngle);
            }, 2000);
        }
    }
    requestAnimationFrame(animateSpin);
}

// Registro del ganador en LocalStorage y Supabase
async function determineWinner(finalAngle) {
    const numSlices = prizes.length;
    const arc = (2 * Math.PI) / numSlices;
    
    const normalizedAngle = (2 * Math.PI - (finalAngle % (2 * Math.PI)) - (Math.PI / 2)) % (2 * Math.PI);
    const winningIndex = Math.floor((normalizedAngle + 2 * Math.PI) % (2 * Math.PI) / arc) % numSlices;

    const winningPrize = prizes[winningIndex];
    lastWinnerPrize = winningPrize;

    // Mostrar ventana modal con el premio
    const prizeText = document.getElementById('winner-prize-text');
    if (prizeText) prizeText.textContent = winningPrize;
    const winnerModal = document.getElementById('winner-modal');
    if (winnerModal) winnerModal.classList.remove('hidden');

    const newWinner = {
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        name: currentPlayer.name,
        phone: currentPlayer.phone,
        prize: winningPrize
    };

    // Guardado local
    winners.unshift(newWinner);
    localStorage.setItem('lafamilia_winners', JSON.stringify(winners));
    loadAdminWinnersTable();

    // Guardado en la nube de Supabase
    if (supabaseClient) {
        try {
            await supabaseClient.from('winners').insert([newWinner]);
        } catch (e) {
            console.error("Error al guardar ganador en Supabase:", e);
        }
    }
}

// ==========================================
// NAVEGACIÓN Y ACCIONES
// ==========================================
function goToHome() {
    const winnerModal = document.getElementById('winner-modal');
    if (winnerModal) winnerModal.classList.add('hidden');

    document.getElementById('screen-game').classList.add('hidden');
    document.getElementById('screen-register').classList.remove('hidden');

    if (regForm) regForm.reset();
    hidePhoneError();
    currentPlayer = { name: '', phone: '' };
    isSpinning = false;
    currentAngle = 0;
    drawRoulette(0);
}

function resetToGameScreen() {
    goToHome();
}

// 4. GESTIÓN DE WHATSAPP REUTILIZANDO LA MISMA PESTAÑA ('ruleta_whatsapp_window')
function shareOnWhatsApp() {
    if (!currentPlayer.phone) return;
    const cleanPhone = String(currentPlayer.phone).replace(/\D/g, '');
    const text = `¡Hola ${currentPlayer.name}! 🎊 Participaste en la Ruleta de la Suerte de La Familia (Servicio y Diagnóstico de Salud) y ganaste: *${lastWinnerPrize}* 🎁. ¡Felicidades! Presenta este mensaje para reclamar tu premio.`;
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
    window.open(waUrl, 'ruleta_whatsapp_window');
}

// ==========================================
// 3. PANEL DE ADMINISTRACIÓN (PIN 1984)
// ==========================================
function openAdminModal() {
    const adminModal = document.getElementById('admin-modal');
    if (adminModal) adminModal.classList.remove('hidden');
    document.getElementById('admin-login-view').classList.remove('hidden');
    document.getElementById('admin-dashboard-view').classList.add('hidden');
    document.getElementById('admin-pin-input').value = '';
}

function closeAdminModal() { 
    const adminModal = document.getElementById('admin-modal');
    if (adminModal) adminModal.classList.add('hidden'); 
}

function verifyAdminPin() {
    const pin = document.getElementById('admin-pin-input').value;
    if (pin === '1984') {
        document.getElementById('admin-login-view').classList.add('hidden');
        document.getElementById('admin-dashboard-view').classList.remove('hidden');
        loadAdminPrizesInputs();
        loadAdminWinnersTable();
        if (supabaseClient) fetchCloudWinners();
    } else {
        alert('PIN incorrecto.');
        document.getElementById('admin-pin-input').value = '';
    }
}

function switchAdminTab(tab) {
    const prizesTab = document.getElementById('admin-tab-prizes');
    const winnersTab = document.getElementById('admin-tab-winners');
    const prizesBtn = document.getElementById('tab-prizes-btn');
    const winnersBtn = document.getElementById('tab-winners-btn');

    prizesTab.classList.add('hidden');
    winnersTab.classList.add('hidden');
    prizesBtn.className = "flex-1 py-2 rounded-xl text-xs font-bold uppercase bg-[#061511] text-slate-300 border border-emerald-500/30 transition-all";
    winnersBtn.className = "flex-1 py-2 rounded-xl text-xs font-bold uppercase bg-[#061511] text-slate-300 border border-emerald-500/30 transition-all";

    if (tab === 'prizes') {
        prizesTab.classList.remove('hidden');
        prizesBtn.className = "flex-1 py-2 rounded-xl text-xs font-bold uppercase bg-emerald-500 text-slate-900 transition-all";
        loadAdminPrizesInputs();
    } else {
        winnersTab.classList.remove('hidden');
        winnersBtn.className = "flex-1 py-2 rounded-xl text-xs font-bold uppercase bg-emerald-500 text-slate-900 transition-all";
        loadAdminWinnersTable();
        if (supabaseClient) fetchCloudWinners();
    }
}

function loadAdminPrizesInputs() {
    const container = document.getElementById('prizes-inputs-container');
    if (!container) return;
    container.innerHTML = '';
    prizes.forEach((prize, index) => {
        container.innerHTML += `
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-emerald-400 w-6">#${index+1}</span>
                <input type="text" id="prize-input-${index}" value="${prize}" 
                    class="w-full px-3 py-2 bg-[#061511] border border-emerald-500/30 rounded-xl text-white text-xs focus:outline-none focus:border-emerald-400">
            </div>
        `;
    });
}

async function savePrizes() {
    for (let i = 0; i < 8; i++) {
        const input = document.getElementById(`prize-input-${i}`);
        if (input) {
            const val = input.value.trim();
            if (val) prizes[i] = val;
        }
    }
    localStorage.setItem('lafamilia_prizes', JSON.stringify(prizes));
    drawRoulette(currentAngle);

    if (supabaseClient) {
        try {
            await supabaseClient.from('prizes').upsert([{ id: 1, items: prizes }]);
        } catch (e) { console.error("Error al guardar premios:", e); }
    }
    alert('¡Premios actualizados y guardados correctamente!');
}

function loadAdminWinnersTable() {
    const tbody = document.getElementById('winners-table-body');
    const countBadge = document.getElementById('winners-count-badge');
    if (countBadge) {
        countBadge.textContent = `(${winners.length} registros)`;
    }

    if (!tbody) return;
    tbody.innerHTML = '';
    if (winners.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">No hay ganadores registrados aún.</td></tr>`;
        return;
    }
    winners.forEach(w => {
        tbody.innerHTML += `
            <tr class="hover:bg-emerald-500/5 transition-colors">
                <td class="p-2 whitespace-nowrap text-slate-400 text-[10px]">${w.date || ''}</td>
                <td class="p-2 font-semibold text-white">${w.name || ''}</td>
                <td class="p-2 text-emerald-300 font-mono">${w.phone || ''}</td>
                <td class="p-2 font-bold text-amber-300">${w.prize || ''}</td>
            </tr>
        `;
    });
}

// ==========================================
// 2. EXPORTACIÓN A EXCEL EN FORMATO TABULADO (.XLS)
// ==========================================
function exportToExcel() {
    if (!winners || winners.length === 0) {
        alert('No hay datos para exportar.');
        return;
    }

    // Cabecera con columnas separadas
    let excelContent = "Fecha\tNombre\tTeléfono\tPremio\n";
    winners.forEach(w => {
        const cleanDate = (w.date || '').replace(/\t|\n/g, ' ');
        const cleanName = (w.name || '').replace(/\t|\n/g, ' ');
        const cleanPhone = (w.phone || '').replace(/\t|\n/g, ' ');
        const cleanPrize = (w.prize || '').replace(/\t|\n/g, ' ');
        excelContent += `${cleanDate}\t${cleanName}\t${cleanPhone}\t${cleanPrize}\n`;
    });

    const blob = new Blob([excelContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ganadores_${new Date().toISOString().slice(0,10)}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ==========================================
// 3. LIMPIAR TODOS LOS DATOS DESDE 0 (LOCAL Y NUBE)
// ==========================================
async function clearAllData() {
    if (!confirm('¿Estás seguro de eliminar TODOS los registros de ganadores? Esta acción vaciará la lista por completo tanto en este dispositivo como en la nube.')) return;
    
    winners = [];
    localStorage.removeItem('lafamilia_winners');
    loadAdminWinnersTable();

    if (supabaseClient) {
        try {
            await supabaseClient.from('winners').delete().neq('id', 0);
        } catch (e) {
            console.error("Error al limpiar la base de datos de Supabase", e);
        }
    }
    alert('¡Todos los registros han sido borrados con éxito!');
}

window.onload = function() {
    initCloud();
};
