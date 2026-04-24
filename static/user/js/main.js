// CIMB Guardian v2 - main.js

// =====================================================
// INDEX.HTML - ANALISA PESAN
// =====================================================
function initAnalyzer() {
    const btn = document.getElementById('btn-analisa');
    const textarea = document.getElementById('input-pesan');
    const emailInput = document.getElementById('input-email');

    if (!btn) {
        console.log('initAnalyzer: btn-analisa tidak ditemukan');
        return;
    }

    btn.addEventListener('click', async function () {
        const pesan = textarea ? textarea.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';

        if (!pesan) {
            alert('Mohon tempelkan pesan yang ingin dianalisa terlebih dahulu.');
            return;
        }

        // simpan email user agar bisa dipakai di halaman berikutnya
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
    const parsed = resultRaw ? JSON.parse(resultRaw) : null;

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
                        <p class="text-sm font-semibold text-on-surface">${item.title}</p>
                        <p class="text-sm text-secondary">${item.description}</p>
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

            btnKirim.disabled = true;
            btnKirim.innerHTML = '<span class="material-symbols-outlined text-lg">autorenew</span> Mengirim...';

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

    if (!btn) {
        console.log('initTracker: btn-cek-status tidak ditemukan');
        return;
    }

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
// JALANKAN SEMUA
// =====================================================
document.addEventListener('DOMContentLoaded', function () {
    initAnalyzer();
    initResult();
    initSuccess();
    initTracker();
});