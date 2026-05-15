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
    const sumberInput = document.getElementById('sumber-pesan');

    if (!btn) return;

    btn.addEventListener('click', async function () {
        const pesan = textarea ? textarea.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const sumberPesan = sumberInput ? sumberInput.value.trim():'';

        if (!pesan) {
            alert('Mohon tempelkan pesan yang ingin dianalisa terlebih dahulu.');
            return;
        }
        if (!sumberPesan){
            alert('Mohon isi sumber pesan terlebih dahulu.');
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
        sessionStorage.setItem('sumberPesan', sumberPesan);

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
            const sumberPesan = sessionStorage.getItem('sumberPesan') || '';

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
    email: email,
    source_message: sumberPesan
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
    id: {
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
    },

    en: {
        security: {
            title: 'Security Policy',
            subtitle: 'Security guidance when using CIMB Guardian.',
            content: `
                <p>
                    CIMB Guardian helps users identify messages, links, phone numbers,
                    or communication patterns that may lead to digital fraud.
                </p>

                <ul class="list-disc pl-5 mt-4 space-y-2">
                    <li>Never share OTP, PIN, password, CVV, or full card details.</li>
                    <li>Check website addresses before entering personal data.</li>
                    <li>Use official bank channels for confirmation.</li>
                    <li>Report suspicious messages immediately through the Message Analysis feature.</li>
                </ul>
            `
        },

        terms: {
            title: 'Terms of Service',
            subtitle: 'CIMB Guardian service usage terms.',
            content: `
                <p>
                    CIMB Guardian is used as an educational and early detection tool
                    for potential digital fraud.
                </p>

                <ul class="list-disc pl-5 mt-4 space-y-2">
                    <li>Analysis results are indicative and may require further verification.</li>
                    <li>Users are responsible for the data submitted to the system.</li>
                    <li>The service does not ask for OTP, PIN, password, or other confidential data.</li>
                    <li>If a loss occurs, contact the official bank channel immediately.</li>
                </ul>
            `
        },

        privacy: {
            title: 'Privacy Center',
            subtitle: 'How we protect user data privacy.',
            content: `
                <p>
                    Data submitted through the analysis feature is only used to help
                    identify risk and create report tickets.
                </p>

                <ul class="list-disc pl-5 mt-4 space-y-2">
                    <li>Email is used to send ticket IDs and report updates.</li>
                    <li>Analyzed messages are used to detect phishing patterns.</li>
                    <li>Avoid entering PINs, OTPs, passwords, or full card numbers.</li>
                    <li>Report data may be reviewed by admins for investigation purposes.</li>
                </ul>
            `
        },

        support: {
            title: 'Contact Support',
            subtitle: 'Support contact if you experience issues.',
            content: `
                <p>
                    If you believe you are a victim of digital fraud, contact the official channels immediately.
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
                        Track your report ticket
                    </a>
                </div>
            `
        },

        securityStatus: {
            title: 'Security Status',
            subtitle: 'System protection status information.',
            content: `
                <div class="space-y-4">
                    <div class="flex items-center justify-between p-4 rounded-xl bg-emerald-50">
                        <div>
                            <p class="font-semibold text-slate-800">Scanner Status</p>
                            <p class="text-xs text-slate-500 mt-1">Message analysis system is active.</p>
                        </div>
                        <span class="text-emerald-600 font-bold text-sm">ACTIVE</span>
                    </div>

                    <div class="flex items-center justify-between p-4 rounded-xl bg-red-50">
                        <div>
                            <p class="font-semibold text-slate-800">Phishing Detection</p>
                            <p class="text-xs text-slate-500 mt-1">Suspicious URL and message pattern checking.</p>
                        </div>
                        <span class="text-red-600 font-bold text-sm">READY</span>
                    </div>
                </div>
            `
        }
    }
};


function openFooterModal(type) {
    const currentLang = localStorage.getItem("cimbGuardianLang") || "id";
    const data = footerModalContent[currentLang]?.[type] || footerModalContent.id?.[type];

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

//------------------
//Translate
//----------------
const translations = {
    id: {
        nav_home: "Beranda",
        nav_track: "Lacak Tiket",
        nav_education: "Edukasi",
        nav_help: "Bantuan",
        nav_login: "Masuk",

        stats_phishing_title: "Serangan Phishing 2023",
        stats_phishing_desc: "Peningkatan upaya penipuan digital di Asia Tenggara dalam 12 bulan terakhir.",
        stats_loss_desc: "Estimasi kerugian nasabah akibat kejahatan siber di Indonesia per tahun.",
        stats_detection_title: "Waktu Deteksi",
        stats_detection_desc: "Kecepatan CIMB Guardian dalam menganalisa ancaman setelah Anda menekan tombol analisa.",

        footer_copyright_2026: "© 2026 CIMB Guardian. Hak Cipta Dilindungi.",
footer_security: "Kebijakan Keamanan",
footer_terms: "Syarat Layanan",
footer_privacy: "Pusat Privasi",
footer_support: "Hubungi Dukungan",

why_title: "Mengapa menggunakan CIMB Guardian?",
why_desc: "Sistem kami dibangun di atas infrastruktur keamanan perbankan global untuk memberikan kepastian hukum dan teknis.",
why_card_1_title: "Keamanan Perbankan",
why_card_1_desc: "Analisis dilakukan menggunakan standar keamanan data finansial internasional.",
why_card_2_title: "Kecerdasan Buatan",
why_card_2_desc: "Model AI kami terus belajar dari jutaan pola serangan phishing terbaru setiap hari.",
why_card_3_title: "Tiket Laporan Otomatis",
why_card_3_desc: "Dapatkan bukti pelaporan digital yang sah untuk keperluan klaim atau investigasi.",
why_card_4_title: "Dukungan Prioritas",
why_card_4_desc: "Analisis berisiko tinggi akan diteruskan langsung ke tim Fraud Response kami.",

tips_title: "Tips Keamanan Digital Utama",
tips_desc: "Langkah cerdas untuk melindungi aset finansial Anda.",
tips_1_title: "Cek URL dan Pengirim",
tips_1_desc: "Jangan pernah mengeklik tautan dari pengirim yang tidak dikenal atau memiliki domain mencurigakan.",
tips_2_title: "Jangan Bagikan OTP",
tips_2_desc: "Bank tidak akan pernah meminta One-Time Password (OTP) Anda melalui telepon, SMS, atau media sosial.",
tips_3_title: "Gunakan 2FA",
tips_3_desc: "Aktifkan Otentikasi Dua Faktor pada semua akun email dan aplikasi mobile banking Anda.",
tips_4_title: "Lapor Segera",
tips_4_desc: "Jika Anda terlanjur memberikan data, segera hubungi call center resmi bank di 14041.",

        hero_badge: "Perlindungan Digital Real-Time",
        hero_title_1: "Lindungi Diri Anda dari",
        hero_title_2: "Penipuan Digital",
        hero_desc: "Tempelkan pesan SMS, WhatsApp, atau email yang mencurigakan untuk analisis phishing instan oleh sistem keamanan cerdas kami.",

        analyze_label: "Analisa Pesan",
        message_placeholder: "Tempelkan konten pesan di sini...",
        email_label: "Alamat Email",
        email_placeholder: "Masukkan email Anda",
        analyze_button: "Analisa Pesan",
        email_info: "Kami akan mengirimkan ID Tiket dan pembaruan laporan ke email ini",

        track_title: "Lacak Status Tiket Anda",
        track_desc: "Periksa perkembangan terbaru laporan keamanan Anda dengan memasukkan detail di bawah ini secara akurat.",
        track_ticket_label: "Masukkan ID Tiket",
        track_ticket_placeholder: "Contoh: CG-2026-00124",
        track_email_label: "Masukkan Alamat Email",
        track_email_placeholder: "email@anda.com",
        track_button: "Cek Status",
        track_help_title: "Butuh Bantuan Segera?",
        track_help_desc: "Jika laporan Anda bersifat mendesak, hubungi pusat panggilan 24/7 kami di 14041.",
        track_detail_label: "Detail Laporan",
        track_received_title: "Laporan Diterima",
        track_received_desc: "Tiket Anda telah berhasil didaftarkan ke sistem.",
        track_current_status_title: "Status Saat Ini",
        track_current_status_desc: "Status laporan akan ditampilkan berdasarkan update terbaru dari sistem.",
        track_url_title: "URL Terdeteksi",
        track_phone_title: "Nomor Terdeteksi",
        track_admin_note_title: "Catatan Admin",
        track_secure_connection: "Koneksi Terenkripsi",
        track_ssl_active: "SSL 256-bit diaktifkan",
        track_system_safe: "Sistem Aman",
        track_realtime_monitoring: "Dipantau secara real-time",

        footer_copyright: "© 2024 CIMB Guardian. Hak Cipta Dilindungi.",
        footer_security: "Kebijakan Keamanan",
        footer_terms: "Syarat Layanan",
        footer_privacy: "Pusat Privasi",
        footer_support: "Hubungi Dukungan",

        help_badge: "Pusat Bantuan",
        help_title_1: "Butuh bantuan menggunakan",
        help_desc: "Temukan panduan penggunaan, cara melacak tiket, informasi keamanan, dan kontak bantuan jika Anda mengalami kendala atau menemukan pesan mencurigakan.",
        help_card_analyze_title: "Analisa Pesan",
        help_card_analyze_desc: "Tempelkan SMS, WhatsApp, atau email mencurigakan untuk mengetahui potensi phishing.",
        help_card_track_title: "Lacak Tiket",
        help_card_track_desc: "Masukkan ID tiket dan email untuk melihat status laporan yang sudah dikirim.",
        help_card_edu_title: "Edukasi Keamanan",
        help_card_edu_desc: "Pelajari ciri-ciri penipuan digital dan cara melindungi data pribadi Anda.",
        help_faq_label: "FAQ",
        help_faq_title: "Pertanyaan yang Sering Diajukan",
        help_faq_1_q: "Bagaimana cara menggunakan fitur Analisa Pesan?",
        help_faq_1_a: "Buka halaman Beranda, tempelkan isi pesan yang mencurigakan, masukkan email jika ingin menerima pembaruan, lalu tekan tombol Analisa Pesan. Sistem akan menampilkan hasil risiko dan rekomendasi tindakan.",
        help_faq_2_q: "Apa fungsi ID tiket?",
        help_faq_2_a: "ID tiket digunakan untuk melacak status laporan Anda. Simpan ID tiket setelah mengirim laporan agar Anda dapat memeriksa pembaruan melalui halaman Lacak Tiket.",
        help_faq_3_q: "Apakah saya boleh memasukkan OTP atau PIN?",
        help_faq_3_a: "Tidak. Jangan pernah memasukkan OTP, PIN, password, CVV, atau nomor kartu lengkap ke dalam sistem. CIMB Guardian hanya membutuhkan isi pesan mencurigakan untuk membantu proses analisis.",
        help_faq_4_q: "Apa yang harus dilakukan jika sudah terlanjur memberikan data?",
        help_faq_4_a: "Segera hubungi call center resmi bank di 14041, ubah password akun terkait, aktifkan autentikasi dua faktor, dan laporkan pesan tersebut melalui CIMB Guardian.",
        help_faq_5_q: "Apakah hasil analisis pasti benar?",
        help_faq_5_a: "Hasil analisis bersifat indikatif sebagai deteksi awal. Untuk kasus berisiko tinggi atau transaksi mencurigakan, tetap lakukan verifikasi melalui kanal resmi bank.",
        help_fast_title: "Butuh Bantuan Cepat?",
        help_fast_desc: "Jika Anda merasa menjadi korban penipuan, segera hubungi kanal resmi.",
        help_email_support: "Email Dukungan",
        help_official_channel: "Kanal Resmi",
        help_main_domain: "Domain utama resmi",
        help_octo_portal: "Portal OCTO",
        help_call_center: "Call center resmi",
        footer_copyright_2026: "© 2026 CIMB Guardian. Hak Cipta Dilindungi.",

        result_title: "Hasil Analisis Keamanan",
        result_desc: "Laporan deteksi potensi ancaman siber untuk pesan yang Anda kirimkan.",
        result_risk_score_title: "Skor Risiko",
        result_indicators_title: "Indikator Ancaman",
        result_recommendations_title: "Rekomendasi Keamanan",
        result_action_title: "Siap mengambil tindakan?",
        result_action_desc: "Konfirmasi tiket akan dikirim ke email Anda segera setelah laporan diproses.",
        result_analyze_another: "Analisa Pesan Lain",
        result_send_report: "Kirim Laporan Penipuan",

        success_title: "Laporan Berhasil Dikirim",
        success_desc: "Terima kasih atas laporan Anda. Tim keamanan kami akan segera meninjau detail yang diberikan.",
        success_ticket_id: "ID TIKET",
        success_confirmation_email: "EMAIL KONFIRMASI",
        success_info: "Simpan ID Tiket Anda dan periksa kotak masuk untuk pembaruan secara berkala. Kami akan mengirimkan notifikasi untuk setiap perubahan status.",
        success_check_ticket: "Cek Status Tiket",
        success_back_home: "Kembali ke Beranda",
        success_encryption: "Enkripsi Tingkat Perbankan",
        success_need_help: "Butuh bantuan segera?",
        success_contact_support: "Hubungi Dukungan 24/7",

        education_badge: "Pusat Keamanan Digital",
education_title: "Lindungi Keuangan Anda dengan Pengetahuan",
education_desc: "Pelajari cara mengidentifikasi ancaman keamanan digital dan langkah-langkah praktis untuk menjaga akun perbankan Anda tetap aman dari penipuan modern.",
education_loading: "Memuat materi edukasi...",
education_cta_title: "Apakah Anda merasa ragu dengan transaksi tertentu?",
education_cta_desc: "Gunakan fitur Analisa Pesan kami untuk melaporkan atau memverifikasi komunikasi yang Anda terima.",
education_score_label: "Skor Edukasi",
education_cta_button: "Mulai Analisa Pesan",
modal_close: "Tutup",

message_source_label: "Sumber Pesan",
message_source_placeholder: "Pilih sumber pesan...",
message_source_other: "Lainnya",
    },

    en: {
        nav_home: "Home",
        nav_track: "Track Ticket",
        nav_education: "Education",
        nav_help: "Help",
        nav_login: "Login",

        footer_copyright_2026: "© 2026 CIMB Guardian. All rights reserved.",
footer_security: "Security Policy",
footer_terms: "Terms of Service",
footer_privacy: "Privacy Center",
footer_support: "Contact Support",

        stats_phishing_title: "Phishing Attacks in 2023",
        stats_phishing_desc: "Increase in digital fraud attempts across Southeast Asia in the last 12 months.",
        stats_loss_desc: "Estimated customer losses caused by cybercrime in Indonesia each year.",
        stats_detection_title: "Detection Time",
        stats_detection_desc: "CIMB Guardian analyzes threats in less than two seconds after you click the analyze button.",

        why_title: "Why use CIMB Guardian?",
        why_desc: "Our system is built on global banking security infrastructure to provide legal and technical assurance.",
        why_card_1_title: "Banking-Grade Security",
        why_card_1_desc: "Analysis is performed using international financial data security standards.",
        why_card_2_title: "Artificial Intelligence",
        why_card_2_desc: "Our AI model continuously learns from millions of the latest phishing attack patterns.",
        why_card_3_title: "Automatic Report Tickets",
        why_card_3_desc: "Get valid digital reporting evidence for claims or investigation purposes.",
        why_card_4_title: "Priority Support",
        why_card_4_desc: "High-risk analysis results are forwarded directly to our Fraud Response team.",

        tips_title: "Essential Digital Security Tips",
        tips_desc: "Smart steps to protect your financial assets.",
        tips_1_title: "Check URLs and Senders",
        tips_1_desc: "Never click links from unknown senders or suspicious-looking domains.",
        tips_2_title: "Never Share OTP Codes",
        tips_2_desc: "Banks will never ask for your One-Time Password (OTP) through calls, SMS, or social media.",
        tips_3_title: "Use 2FA",
        tips_3_desc: "Enable two-factor authentication on all email accounts and mobile banking apps.",
        tips_4_title: "Report Immediately",
        tips_4_desc: "If you have already shared sensitive data, contact the official bank call center at 14041 immediately.",

        hero_badge: "Real-Time Digital Protection",
        hero_title_1: "Protect Yourself from",
        hero_title_2: "Digital Fraud",
        hero_desc: "Paste suspicious SMS, WhatsApp, or email messages for instant phishing analysis by our intelligent security system.",

        analyze_label: "Message Analysis",
        message_placeholder: "Paste the message content here...",
        email_label: "Email Address",
        email_placeholder: "Enter your email address",
        analyze_button: "Analyze Message",
        email_info: "We will send the Ticket ID and report updates to this email address",

        track_title: "Track Your Ticket Status",
        track_desc: "Check the latest progress of your security report by entering the details accurately below.",
        track_ticket_label: "Enter Ticket ID",
        track_ticket_placeholder: "Example: CG-2026-00124",
        track_email_label: "Enter Email Address",
        track_email_placeholder: "your@email.com",
        track_button: "Check Status",
        track_help_title: "Need Immediate Help?",
        track_help_desc: "If your report is urgent, contact our 24/7 call center at 14041.",
        track_detail_label: "Report Details",
        track_received_title: "Report Received",
        track_received_desc: "Your ticket has been successfully registered in the system.",
        track_current_status_title: "Current Status",
        track_current_status_desc: "The report status will be displayed based on the latest system update.",
        track_url_title: "Detected URL",
        track_phone_title: "Detected Phone Number",
        track_admin_note_title: "Admin Note",
        track_secure_connection: "Encrypted Connection",
        track_ssl_active: "256-bit SSL enabled",
        track_system_safe: "Secure System",
        track_realtime_monitoring: "Monitored in real time",

        footer_copyright: "© 2024 CIMB Guardian. All rights reserved.",
        footer_security: "Security Policy",
        footer_terms: "Terms of Service",
        footer_privacy: "Privacy Center",
        footer_support: "Contact Support",

        help_badge: "Help Center",
        help_title_1: "Need help using",
        help_desc: "Find usage guides, ticket tracking instructions, security information, and support contacts if you experience issues or find suspicious messages.",
        help_card_analyze_title: "Analyze Message",
        help_card_analyze_desc: "Paste suspicious SMS, WhatsApp, or email messages to identify possible phishing.",
        help_card_track_title: "Track Ticket",
        help_card_track_desc: "Enter your ticket ID and email to view the status of a submitted report.",
        help_card_edu_title: "Security Education",
        help_card_edu_desc: "Learn the signs of digital fraud and how to protect your personal data.",
        help_faq_label: "FAQ",
        help_faq_title: "Frequently Asked Questions",
        help_faq_1_q: "How do I use the Message Analysis feature?",
        help_faq_1_a: "Open the Home page, paste the suspicious message content, enter your email if you want to receive updates, then press the Analyze Message button. The system will display the risk result and recommended actions.",
        help_faq_2_q: "What is the Ticket ID used for?",
        help_faq_2_a: "The Ticket ID is used to track your report status. Save the Ticket ID after submitting a report so you can check updates through the Track Ticket page.",
        help_faq_3_q: "Can I enter an OTP or PIN?",
        help_faq_3_a: "No. Never enter OTP, PIN, password, CVV, or full card numbers into the system. CIMB Guardian only needs the suspicious message content to support analysis.",
        help_faq_4_q: "What should I do if I already shared my data?",
        help_faq_4_a: "Immediately contact the bank's official call center at 14041, change the password of related accounts, enable two-factor authentication, and report the message through CIMB Guardian.",
        help_faq_5_q: "Is the analysis result always correct?",
        help_faq_5_a: "The analysis result is indicative as an early detection tool. For high-risk cases or suspicious transactions, always verify through the bank's official channels.",
        help_fast_title: "Need Quick Help?",
        help_fast_desc: "If you believe you are a victim of fraud, contact the official channels immediately.",
        help_email_support: "Email Support",
        help_official_channel: "Official Channels",
        help_main_domain: "Official main domain",
        help_octo_portal: "OCTO Portal",
        help_call_center: "Official call center",
        footer_copyright_2026: "© 2026 CIMB Guardian. All rights reserved.",

        result_title: "Security Analysis Result",
        result_desc: "Cyber threat detection report for the message you submitted.",
        result_risk_score_title: "Risk Score",
        result_indicators_title: "Threat Indicators",
        result_recommendations_title: "Security Recommendations",
        result_action_title: "Ready to take action?",
        result_action_desc: "Ticket confirmation will be sent to your email after the report is processed.",
        result_analyze_another: "Analyze Another Message",
        result_send_report: "Submit Fraud Report",

        success_title: "Report Successfully Submitted",
        success_desc: "Thank you for your report. Our security team will review the submitted details shortly.",
        success_ticket_id: "TICKET ID",
        success_confirmation_email: "CONFIRMATION EMAIL",
        success_info: "Save your Ticket ID and check your inbox regularly for updates. We will send notifications for every status change.",
        success_check_ticket: "Check Ticket Status",
        success_back_home: "Back to Home",
        success_encryption: "Bank-Level Encryption",
        success_need_help: "Need immediate help?",
        success_contact_support: "Contact 24/7 Support",

        education_badge: "Digital Security Center",
        education_title: "Protect Your Finances with Knowledge",
        education_desc: "Learn how to identify digital security threats and practical steps to keep your banking accounts safe from modern fraud.",
        education_loading: "Loading education materials...",
        education_cta_title: "Are you unsure about a certain transaction?",
        education_cta_desc: "Use our Message Analysis feature to report or verify the communication you received.",
        education_score_label: "Education Score",
        education_cta_button: "Start Message Analysis",
        modal_close: "Close",

        message_source_label: "Message Source",
        message_source_placeholder: "Select message source...",
        message_source_other: "Other",
    }
};

function applyLanguage(lang) {
    const dict = translations[lang] || translations.id;

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
        const key = el.getAttribute("data-i18n");
        if (dict[key]) {
            el.textContent = dict[key];
        }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
        const key = el.getAttribute("data-i18n-placeholder");
        if (dict[key]) {
            el.setAttribute("placeholder", dict[key]);
        }
    });

    localStorage.setItem("cimbGuardianLang", lang);

    const btn = document.getElementById("btn-language");
    if (btn) {
        btn.textContent = lang === "id" ? "EN" : "ID";
    }

    document.documentElement.lang = lang;
}

function initLanguageToggle() {
    const savedLang = localStorage.getItem("cimbGuardianLang") || "id";
    applyLanguage(savedLang);

    const btn = document.getElementById("btn-language");
    if (!btn) return;

    btn.addEventListener("click", function () {
        const currentLang = localStorage.getItem("cimbGuardianLang") || "id";
        const nextLang = currentLang === "id" ? "en" : "id";
        applyLanguage(nextLang);
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
    if (typeof initLanguageToggle === 'function') initLanguageToggle();
});