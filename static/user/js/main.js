// CIMB Guardian v2 - main.js

// =====================================================
// HELPER
// =====================================================
function safeJsonParse(value, fallback = null) {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch (err) {
        console.error('JSON parse error:', err);
        return fallback;
    }
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// =====================================================
// INDEX.HTML - ANALISA PESAN
// =====================================================
function initAnalyzer() {
    const btn = document.getElementById('btn-analisa');
    const textarea = document.getElementById('input-pesan');
    const emailInput = document.getElementById('input-email');

    if (!btn) return;

    btn.addEventListener('click', async function () {
        const pesan = textarea ? textarea.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';

        if (!pesan) {
            alert('Mohon tempelkan pesan yang ingin dianalisa terlebih dahulu.');
            return;
        }

        if (email && !isValidEmail(email)) {
            alert('Mohon masukkan alamat email yang valid.');
            return;
        }

        if (email) {
            sessionStorage.setItem('emailPengguna', email);
        } else {
            sessionStorage.removeItem('emailPengguna');
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin">autorenew</span> Menganalisa...';

        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message_text: pesan }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || 'Gagal menganalisa pesan');
            }

            sessionStorage.setItem('analysisResult', JSON.stringify(data));
            sessionStorage.setItem('pesanDianalisis', pesan);

            window.location.href = '/result.html';
        } catch (err) {
            alert('❌ ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined">analytics</span> Analisa Pesan';
        }
    });
}


// =====================================================
// RESULT.HTML - TAMPILKAN HASIL & KIRIM LAPORAN
// =====================================================
function initResult() {
    const btnKirim = document.getElementById('btn-kirim-laporan');
    const btnAnalisa = document.getElementById('btn-analisa-lain');

    const resultRaw = sessionStorage.getItem('analysisResult');
    const parsed = safeJsonParse(resultRaw, null);

    const scoreEl = document.getElementById('risk-score');
    const badgeEl = document.getElementById('risk-badge');
    const summaryEl = document.getElementById('risk-summary');
    const indicatorsList = document.getElementById('indicators-list');
    const recommendationsList = document.getElementById('recommendations-list');

    if (parsed) {
        if (scoreEl) scoreEl.textContent = parsed.risk_score ?? 0;
        if (summaryEl) summaryEl.textContent = parsed.summary ?? '-';

        if (badgeEl) {
            badgeEl.innerHTML = `
                <span class="material-symbols-outlined text-lg">warning</span>
                ${parsed.risk_level ?? '-'}
            `;
        }

        if (indicatorsList && Array.isArray(parsed.indicators)) {
            indicatorsList.innerHTML = parsed.indicators.map(item => `
                <div class="flex items-start gap-4 p-4 rounded-lg bg-surface-container-low border border-outline-variant">
                    <span class="material-symbols-outlined text-error mt-1">warning</span>
                    <div>
                        <p class="text-sm font-semibold text-on-surface">${item.title || '-'}</p>
                        <p class="text-sm text-secondary">${item.description || '-'}</p>
                    </div>
                </div>
            `).join('');
        }

        if (recommendationsList && Array.isArray(parsed.recommendations)) {
            recommendationsList.innerHTML = parsed.recommendations.map(item => `
                <div class="flex flex-col gap-2">
                    <div class="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                        <span class="material-symbols-outlined text-primary">security</span>
                    </div>
                    <p class="text-sm font-semibold">${item}</p>
                </div>
            `).join('');
        }
    }

    if (btnKirim) {
        btnKirim.addEventListener('click', async function () {
            const pesan = sessionStorage.getItem('pesanDianalisis') || '';
            const email = sessionStorage.getItem('emailPengguna') || '';

            if (!pesan) {
                alert('Pesan belum tersedia untuk dilaporkan.');
                return;
            }

            if (email && !isValidEmail(email)) {
                alert('Email yang tersimpan tidak valid.');
                return;
            }

            btnKirim.disabled = true;
            btnKirim.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">autorenew</span> Mengirim...';

            try {
                const res = await fetch('/api/report', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message_text: pesan,
                        email: email
                    }),
                });

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.message || 'Gagal mengirim laporan');
                }

                sessionStorage.setItem('ticketId', data.ticket_id || '');
                sessionStorage.setItem('lastReportResult', JSON.stringify(data));

                window.location.href = '/success.html';
            } catch (err) {
                alert('❌ ' + err.message);
            } finally {
                btnKirim.disabled = false;
                btnKirim.innerHTML = '<span class="material-symbols-outlined text-lg">send</span> Kirim Laporan Penipuan';
            }
        });
    }

    if (btnAnalisa) {
        btnAnalisa.addEventListener('click', function () {
            sessionStorage.removeItem('analysisResult');
            sessionStorage.removeItem('pesanDianalisis');
            window.location.href = '/index.html';
        });
    }
}


// =====================================================
// SUCCESS.HTML - TAMPILKAN TICKET
// =====================================================
function initSuccess() {
    const btnCek = document.getElementById('btn-cek-tiket');
    const btnBeranda = document.getElementById('btn-kembali-beranda');

    const emailEl = document.getElementById('display-email');
    const ticketEl = document.getElementById('ticket-id-display');
    const timestampEl = document.getElementById('timestamp-display');

    const email = sessionStorage.getItem('emailPengguna');
    const ticketId = sessionStorage.getItem('ticketId');

    if (emailEl) {
        emailEl.textContent = email || '-';
    }

    if (ticketEl) {
        ticketEl.textContent = ticketId || '-';
    }

    if (timestampEl) {
        timestampEl.textContent = new Date().toLocaleString('id-ID');
    }

    if (btnCek) {
        btnCek.addEventListener('click', function () {
            window.location.href = '/track.html';
        });
    }

    if (btnBeranda) {
        btnBeranda.addEventListener('click', function () {
            window.location.href = '/index.html';
        });
    }
}


// =====================================================
// TRACK.HTML - CEK TIKET DARI BACKEND
// =====================================================
function initTracker() {
    const btn = document.getElementById('btn-cek-status');
    const inputId = document.getElementById('ticket-id') || document.getElementById('input-ticket');
    const inputEmail = document.getElementById('email');

    if (!btn) return;

    btn.addEventListener('click', async function () {
        const id = inputId ? inputId.value.trim() : '';
        const email = inputEmail ? inputEmail.value.trim() : '';

        if (!id) {
            alert('Mohon masukkan ID Tiket.');
            return;
        }

        if (!email) {
            alert('Mohon masukkan email.');
            return;
        }

        if (!isValidEmail(email)) {
            alert('Mohon masukkan alamat email yang valid.');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin">autorenew</span> Memeriksa...';

        try {
            const res = await fetch(`/api/ticket/${encodeURIComponent(id)}`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || 'Tiket tidak ditemukan');
            }

            const ticketIdEl = document.getElementById('track-ticket-id');
            const statusEl = document.getElementById('track-status');
            const createdEl = document.getElementById('track-created');
            const updatedEl = document.getElementById('track-updated');
            const updatedCopyEl = document.getElementById('track-updated-copy');
            const urlsEl = document.getElementById('track-urls');
            const phonesEl = document.getElementById('track-phones');
            const noteEl = document.getElementById('track-note');
            const resultSection = document.getElementById('result-section');

            if (ticketIdEl) ticketIdEl.textContent = data.ticket_id || '-';

            if (statusEl) {
                statusEl.innerHTML = `
                    <span class="material-symbols-outlined text-sm">pending</span>
                    ${data.admin_status || '-'}
                `;
            }

            if (createdEl) createdEl.textContent = data.created_at || '-';
            if (updatedEl) updatedEl.textContent = data.updated_at || '-';
            if (updatedCopyEl) updatedCopyEl.textContent = data.updated_at || '-';
            if (urlsEl) urlsEl.textContent = data.extracted_urls || '-';
            if (phonesEl) phonesEl.textContent = data.extracted_phones || '-';
            if (noteEl) noteEl.textContent = data.admin_note || '-';

            if (resultSection) {
                resultSection.classList.remove('hidden');
            }
        } catch (err) {
            alert('❌ ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined">search</span> Cek Status';
        }
    });
}


// =====================================================
// FOOTER MODAL - INDEX.HTML
// =====================================================
const footerModalContent = {
    security: {
        title: 'Kebijakan Keamanan',
        subtitle: 'Panduan keamanan saat menggunakan CIMB Guardian.',
        content: `
            <p>
                CIMB Guardian membantu pengguna mengenali pesan, tautan, nomor telepon,
                atau pola komunikasi yang berpotensi mengarah ke penipuan digital.
            </p>

            <ul class="list-disc pl-5 mt-4 space-y-2">
                <li>Jangan pernah membagikan OTP, PIN, password, CVV, atau data kartu lengkap.</li>
                <li>Periksa alamat website sebelum memasukkan data pribadi.</li>
                <li>Gunakan kanal resmi bank untuk melakukan konfirmasi.</li>
                <li>Segera laporkan pesan mencurigakan melalui fitur Analisa Pesan.</li>
            </ul>
        `
    },

    terms: {
        title: 'Syarat Layanan',
        subtitle: 'Ketentuan penggunaan layanan CIMB Guardian.',
        content: `
            <p>
                CIMB Guardian digunakan sebagai alat bantu edukasi dan deteksi awal
                terhadap potensi penipuan digital.
            </p>

            <ul class="list-disc pl-5 mt-4 space-y-2">
                <li>Hasil analisis bersifat indikatif dan perlu diverifikasi lebih lanjut.</li>
                <li>Pengguna bertanggung jawab atas data yang dimasukkan ke sistem.</li>
                <li>Layanan tidak meminta OTP, PIN, password, atau data rahasia lainnya.</li>
                <li>Jika terjadi kerugian, segera hubungi kanal resmi bank.</li>
            </ul>
        `
    },

    privacy: {
        title: 'Pusat Privasi',
        subtitle: 'Cara kami menjaga privasi data pengguna.',
        content: `
            <p>
                Data yang dikirim melalui fitur analisa hanya digunakan untuk membantu
                proses identifikasi risiko dan pembuatan tiket laporan.
            </p>

            <ul class="list-disc pl-5 mt-4 space-y-2">
                <li>Email digunakan untuk mengirim ID tiket dan pembaruan laporan.</li>
                <li>Pesan yang dianalisis digunakan untuk mendeteksi pola phishing.</li>
                <li>Hindari memasukkan PIN, OTP, password, atau nomor kartu lengkap.</li>
                <li>Data laporan dapat ditinjau oleh admin untuk proses investigasi.</li>
            </ul>
        `
    },

    support: {
        title: 'Hubungi Dukungan',
        subtitle: 'Kontak bantuan jika Anda mengalami kendala.',
        content: `
            <p>
                Jika Anda merasa menjadi korban penipuan digital, segera hubungi kanal resmi.
            </p>

            <div class="mt-4 space-y-3">
                <a href="tel:14041" class="flex items-center gap-2 font-semibold text-red-600 hover:underline">
                    <span class="material-symbols-outlined text-lg">call</span>
                    Call Center: 14041
                </a>

                <a href="mailto:support@cimbguardian.local" class="flex items-center gap-2 font-semibold text-red-600 hover:underline">
                    <span class="material-symbols-outlined text-lg">mail</span>
                    support@cimbguardian.local
                </a>

                <a href="/track.html" class="flex items-center gap-2 font-semibold text-red-600 hover:underline">
                    <span class="material-symbols-outlined text-lg">confirmation_number</span>
                    Lacak tiket laporan Anda
                </a>
            </div>
        `
    },

    language: {
        title: 'Pengaturan Bahasa',
        subtitle: 'Pilihan bahasa tampilan.',
        content: `
            <p>
                Saat ini CIMB Guardian menggunakan Bahasa Indonesia sebagai bahasa utama.
            </p>

            <div class="mt-4 grid grid-cols-2 gap-3">
                <button type="button" class="px-4 py-3 rounded-lg bg-red-50 text-red-600 font-semibold">
                    Indonesia
                </button>

                <button type="button" class="px-4 py-3 rounded-lg bg-slate-100 text-slate-500 font-semibold cursor-not-allowed">
                    English segera hadir
                </button>
            </div>
        `
    },

    securityStatus: {
        title: 'Status Keamanan',
        subtitle: 'Informasi status perlindungan sistem.',
        content: `
            <div class="space-y-4">
                <div class="flex items-center justify-between p-4 rounded-xl bg-emerald-50">
                    <div>
                        <p class="font-semibold text-slate-800">Scanner Status</p>
                        <p class="text-xs text-slate-500 mt-1">Sistem analisa pesan aktif.</p>
                    </div>
                    <span class="text-emerald-600 font-bold text-sm">AKTIF</span>
                </div>

                <div class="flex items-center justify-between p-4 rounded-xl bg-red-50">
                    <div>
                        <p class="font-semibold text-slate-800">Deteksi Phishing</p>
                        <p class="text-xs text-slate-500 mt-1">Pemeriksaan URL dan pola pesan mencurigakan.</p>
                    </div>
                    <span class="text-red-600 font-bold text-sm">SIAP</span>
                </div>
            </div>
        `
    }
};

function openFooterModal(type) {
    const data = footerModalContent[type];
    if (!data) return;

    const modal = document.getElementById('footer-modal');
    const title = document.getElementById('footer-modal-title');
    const subtitle = document.getElementById('footer-modal-subtitle');
    const content = document.getElementById('footer-modal-content');

    if (!modal || !title || !subtitle || !content) return;

    title.textContent = data.title;
    subtitle.textContent = data.subtitle;
    content.innerHTML = data.content;

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeFooterModal() {
    const modal = document.getElementById('footer-modal');
    if (!modal) return;

    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

function initFooterActions() {
    document.querySelectorAll('.footer-action').forEach(button => {
        button.addEventListener('click', function () {
            openFooterModal(button.dataset.footer);
        });
    });

    const languageBtn = document.getElementById('btn-language');
const officialBtn = document.getElementById('btn-official-channel');
const closeBtn = document.getElementById('footer-modal-close');
const overlay = document.getElementById('footer-modal-overlay');

if (languageBtn) {
    languageBtn.addEventListener('click', function () {
        openFooterModal('language');
    });
}

if (officialBtn) {
    officialBtn.addEventListener('click', function () {
        openFooterModal('securityStatus');
    });
}

    if (closeBtn) {
        closeBtn.addEventListener('click', closeFooterModal);
    }

    if (overlay) {
        overlay.addEventListener('click', closeFooterModal);
    }

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeFooterModal();
        }
    });
}

// =====================================================
// INDEX.HTML - INTERACTIVE SECURITY SCORE
// =====================================================
function initSecurityScore() {
    const card = document.getElementById('security-score-card');
    const ring = document.getElementById('security-score-ring');
    const number = document.getElementById('security-score-number');
    const label = document.getElementById('security-score-label');

    if (!card || !ring || !number || !label) return;

    const targetScore = Number(card.dataset.score || 85);
    const radius = 84;
    const circumference = 2 * Math.PI * radius;

    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference}`;

    function getScoreLabel(score) {
        if (score >= 80) return 'Aman';
        if (score >= 50) return 'Waspada';
        return 'Berisiko';
    }

    function getScoreColor(score) {
        if (score >= 80) return '#b5000b';
        if (score >= 50) return '#f59e0b';
        return '#dc2626';
    }

    function animateScore() {
        let current = 0;
        const duration = 1400;
        const startTime = performance.now();

        function update(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            current = Math.round(targetScore * eased);

            const offset = circumference - (current / 100) * circumference;

            number.textContent = current;
            label.textContent = getScoreLabel(current);
            ring.style.strokeDashoffset = offset;
            ring.style.stroke = getScoreColor(current);

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                number.classList.add('security-score-pulse');
            }
        }

        requestAnimationFrame(update);
    }

    animateScore();

    card.addEventListener('mouseenter', function () {
        ring.style.strokeWidth = '15';
    });

    card.addEventListener('mouseleave', function () {
        ring.style.strokeWidth = '12';
    });

    card.addEventListener('click', function () {
        animateScore();
    });
}
// =====================================================
// JALANKAN SEMUA
// =====================================================
document.addEventListener('DOMContentLoaded', function () {
    if (typeof initAnalyzer === 'function') initAnalyzer();
    if (typeof initResult === 'function') initResult();
    if (typeof initSuccess === 'function') initSuccess();
    if (typeof initTracker === 'function') initTracker();
    if (typeof initFooterActions === 'function') initFooterActions();
    if (typeof initSecurityScore === 'function') initSecurityScore();
});