// ============================================
// FraudGuard Admin - admin.js
// ============================================

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getStatusBadge(status) {
    const s = String(status || 'Pending').trim();

    if (s === 'Fraud') {
        return '<span class="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-bold">Fraud</span>';
    }
    if (s === 'Diproses') {
        return '<span class="bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-xs font-bold">Diproses</span>';
    }
    if (s === 'Aman') {
        return '<span class="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-xs font-bold">Aman</span>';
    }
    return '<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-xs font-bold">Pending</span>';
}

function getRiskTextClass(score) {
    const n = Number(score || 0);
    if (n >= 70) return 'text-red-600';
    if (n >= 40) return 'text-orange-500';
    return 'text-emerald-600';
}

function getRiskBarClass(score) {
    const n = Number(score || 0);
    if (n >= 70) return 'bg-red-600';
    if (n >= 40) return 'bg-orange-500';
    return 'bg-emerald-600';
}

async function loadAdminSummary() {
    try {
        const res = await fetch('/admin/summary');
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal mengambil summary');
        }

        const totalEl = document.getElementById('summary-total-reports');
        const pendingEl = document.getElementById('summary-pending-reports');
        const highRiskEl = document.getElementById('summary-high-risk-reports');
        const amanEl = document.getElementById('summary-aman-reports');

        if (totalEl) totalEl.textContent = data.total_reports ?? 0;
        if (pendingEl) pendingEl.textContent = data.pending_reports ?? 0;
        if (highRiskEl) highRiskEl.textContent = data.high_risk_reports ?? 0;
        if (amanEl) amanEl.textContent = data.aman_reports ?? 0;
    } catch (err) {
        console.error('loadAdminSummary:', err);
    }
}

function buildTableRow(item) {
    const ticketId = escapeHtml(item.ticket_id || '-');
    const reporterEmail = escapeHtml(item.reporter_email || '-');
    const riskScore = Number(item.risk_score || 0);
    const statusBadge = getStatusBadge(item.admin_status);

    return `
        <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="px-6 py-4 font-bold text-slate-700">${ticketId}</td>
            <td class="px-6 py-4 text-slate-600 text-sm">${reporterEmail}</td>
            <td class="px-6 py-4">
                <div class="flex flex-col items-center">
                    <span class="${getRiskTextClass(riskScore)} font-bold">${riskScore}%</span>
                    <div class="w-16 h-1 bg-slate-100 rounded-full mt-1">
                        <div class="${getRiskBarClass(riskScore)} h-full rounded-full" style="width:${Math.min(riskScore, 100)}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">${getStatusBadge(item.admin_status)}</td>
            <td class="px-6 py-4 text-right">
                <button class="btn-review text-primary font-bold text-sm hover:underline" data-ticket="${ticketId}">
                    Review
                </button>
            </td>
        </tr>
    `;
}

function buildPriorityItem(item) {
    const riskScore = Number(item.risk_score || 0);
    const ticketId = escapeHtml(item.ticket_id || '-');
    const messageText = escapeHtml((item.message_text || '').slice(0, 60) || 'Tidak ada deskripsi');

    return `
        <div class="risk-item group p-3 rounded-xl border border-transparent hover:border-red-100 hover:bg-red-50/30 transition-all cursor-pointer" data-ticket="${ticketId}">
            <div class="flex justify-between items-start">
                <div>
                    <p class="text-xs font-bold text-red-600 uppercase mb-1">Score: ${riskScore}%</p>
                    <p class="font-bold text-slate-800 text-sm">${ticketId}</p>
                    <p class="text-xs text-slate-500">${messageText}</p>
                </div>
                <span class="material-symbols-outlined text-slate-300 group-hover:text-red-400 transition-colors">arrow_forward</span>
            </div>
        </div>
    `;
}

async function loadAdminReports() {
    const tbody = document.getElementById('reports-table-body');
    const tableInfo = document.getElementById('reports-table-info');
    const priorityList = document.getElementById('risk-priority-list');

    if (!tbody) return;

    try {
        const res = await fetch('/admin/reports');
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal mengambil laporan admin');
        }

        if (!Array.isArray(data) || data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-6 text-center text-slate-400">Belum ada laporan dari user.</td>
                </tr>
            `;
            if (tableInfo) tableInfo.textContent = 'Menampilkan 0 laporan';
            if (priorityList) priorityList.innerHTML = '<div class="text-sm text-slate-400">Belum ada kasus prioritas.</div>';
            return;
        }

        const latestReports = data.slice(0, 10);
        tbody.innerHTML = latestReports.map(buildTableRow).join('');

        if (tableInfo) {
            tableInfo.textContent = `Menampilkan ${latestReports.length} dari ${data.length} laporan`;
        }

        if (priorityList) {
            const highRisk = data
                .filter(item => Number(item.risk_score || 0) >= 70 || item.risk_level === 'High Risk')
                .slice(0, 5);

            priorityList.innerHTML = highRisk.length
                ? highRisk.map(buildPriorityItem).join('')
                : '<div class="text-sm text-slate-400">Belum ada kasus risiko tinggi.</div>';
        }

        bindReviewButtons();
        bindRiskItems();
        bindSearch(data);
    } catch (err) {
        console.error('loadAdminReports:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-6 text-center text-red-500">${escapeHtml(err.message)}</td>
            </tr>
        `;
        if (priorityList) {
            priorityList.innerHTML = '<div class="text-sm text-red-500">Gagal memuat prioritas risiko.</div>';
        }
    }
}

function bindReviewButtons() {
    document.querySelectorAll('.btn-review').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const ticketId = btn.getAttribute('data-ticket') || '';
            sessionStorage.setItem('activeTicket', ticketId);
            window.location.href = `/admin/case-review.html?ticket_id=${encodeURIComponent(ticketId)}`;
        });
    });
}

function bindRiskItems() {
    document.querySelectorAll('.risk-item').forEach(function (item) {
        item.addEventListener('click', function () {
            const ticketId = item.getAttribute('data-ticket') || '';
            sessionStorage.setItem('activeTicket', ticketId);
            window.location.href = `/admin/case-review.html?ticket_id=${encodeURIComponent(ticketId)}`;
        });
    });
}

function bindSearch(allData) {
    const searchInput = document.getElementById('admin-search');
    const tbody = document.getElementById('reports-table-body');
    const tableInfo = document.getElementById('reports-table-info');

    if (!searchInput || !tbody) return;

    searchInput.addEventListener('input', function () {
        const keyword = searchInput.value.trim().toLowerCase();

        const filtered = allData.filter(item => {
            const ticket = String(item.ticket_id || '').toLowerCase();
            const email = String(item.reporter_email || '').toLowerCase();
            const message = String(item.message_text || '').toLowerCase();
            return ticket.includes(keyword) || email.includes(keyword) || message.includes(keyword);
        });

        if (!filtered.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-6 text-center text-slate-400">Tidak ada data yang cocok.</td>
                </tr>
            `;
            if (tableInfo) tableInfo.textContent = 'Menampilkan 0 laporan';
            return;
        }

        const rows = filtered.slice(0, 10);
        tbody.innerHTML = rows.map(buildTableRow).join('');
        if (tableInfo) tableInfo.textContent = `Menampilkan ${rows.length} dari ${filtered.length} laporan hasil pencarian`;
        bindReviewButtons();
    });
}

function getCurrentTicketId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ticket_id') || sessionStorage.getItem('activeTicket') || '';
}

async function loadCaseReviewDetail() {
    const ticketId = getCurrentTicketId();
    if (!ticketId) return;

    try {
        const res = await fetch(`/admin/report/${encodeURIComponent(ticketId)}`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal mengambil detail laporan');
        }

        const ticketText = data.ticket_id || '-';
        const emailText = data.reporter_email || '-';
        const createdText = data.created_at || '-';
        const statusText = data.admin_status || 'Pending';
        const riskScore = Number(data.risk_score || 0);
        const riskLevel = data.risk_level || '-';
        const messageText = data.message_text || '-';
        const urlsText = data.extracted_urls || '-';
        const phonesText = data.extracted_phones || '-';
        const noteText = data.admin_note || '';

        const breadcrumbTicket = document.getElementById('breadcrumb-ticket');
        const pageTitleTicket = document.getElementById('page-title-ticket');
        const reportIdSmall = document.getElementById('report-id-small');
        const detailEmail = document.getElementById('detail-email');
        const detailCreatedAt = document.getElementById('detail-created-at');
        const detailStatus = document.getElementById('detail-status');
        const reportedMsg = document.getElementById('reported-msg');
        const detailUrls = document.getElementById('detail-urls');
        const detailPhones = document.getElementById('detail-phones');
        const adminNote = document.getElementById('admin-note');
        const detailConfidence = document.getElementById('detail-confidence');
        const detailRiskLabel = document.getElementById('detail-risk-label');
        const detailRiskBar = document.getElementById('detail-risk-bar');
        const detailRiskLevel = document.getElementById('detail-risk-level');
        const analysisUrl = document.getElementById('analysis-url');
        const analysisPhone = document.getElementById('analysis-phone');

        if (breadcrumbTicket) breadcrumbTicket.textContent = ticketText;
        if (pageTitleTicket) pageTitleTicket.textContent = ticketText;
        if (reportIdSmall) reportIdSmall.textContent = `ID: ${ticketText}`;
        if (detailEmail) detailEmail.textContent = emailText;
        if (detailCreatedAt) detailCreatedAt.textContent = createdText;
        if (detailStatus) detailStatus.innerHTML = getStatusBadge(statusText);
        if (reportedMsg) reportedMsg.textContent = messageText;
        if (detailUrls) detailUrls.textContent = urlsText || '-';
        if (detailPhones) detailPhones.textContent = phonesText || '-';
        if (adminNote) adminNote.value = noteText;
        if (detailConfidence) detailConfidence.textContent = `${riskScore}% Confidence`;
        if (detailRiskLabel) detailRiskLabel.textContent = `${riskScore}%`;
        if (detailRiskBar) detailRiskBar.style.width = `${Math.min(riskScore, 100)}%`;
        if (detailRiskLevel) detailRiskLevel.textContent = riskLevel;
        if (analysisUrl) analysisUrl.textContent = urlsText || 'Tidak ada URL terdeteksi';
        if (analysisPhone) analysisPhone.textContent = phonesText || 'Tidak ada nomor terdeteksi';

        sessionStorage.setItem('activeTicket', ticketText);
    } catch (err) {
        console.error('loadCaseReviewDetail:', err);
        showToast(err.message, 'error');
    }
}

async function updateAdminStatus(ticketId, status, note = '') {
    try {
        const res = await fetch(`/admin/report/${encodeURIComponent(ticketId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_status: status,
                admin_note: note
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Gagal memperbarui status');

        showToast('Status berhasil diperbarui.', 'success');
        setTimeout(() => {
            window.location.href = '/admin/dashboard.html';
        }, 1000);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function initPhishingDecision() {
    const btnPhishing = document.getElementById('btn-phishing');
    if (!btnPhishing) return;

    btnPhishing.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = document.getElementById('admin-note')?.value.trim() || 'Kasus ditandai sebagai phishing oleh admin.';
        if (!ticketId) return alert('Ticket tidak ditemukan.');
        if (!confirm('Tandai kasus ini sebagai FRAUD/PHISHING?')) return;
        updateAdminStatus(ticketId, 'Fraud', note);
    });
}

function initEscalation() {
    const btnEskalasi = document.getElementById('btn-eskalasi');
    if (!btnEskalasi) return;

    btnEskalasi.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = document.getElementById('admin-note')?.value.trim() || 'Kasus sedang diproses oleh admin.';
        if (!ticketId) return alert('Ticket tidak ditemukan.');
        updateAdminStatus(ticketId, 'Diproses', note);
    });
}

function initMarkSafe() {
    const btnAman = document.getElementById('btn-aman');
    if (!btnAman) return;

    btnAman.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = document.getElementById('admin-note')?.value.trim() || 'Kasus dinyatakan aman oleh admin.';
        if (!ticketId) return alert('Ticket tidak ditemukan.');
        if (!confirm('Tandai kasus ini sebagai AMAN?')) return;
        updateAdminStatus(ticketId, 'Aman', note);
    });
}

function initSaveNote() {
    const btn = document.getElementById('btn-save-note');
    const textarea = document.getElementById('admin-note');
    if (!btn || !textarea) return;

    btn.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = textarea.value.trim();

        if (!ticketId) {
            alert('Ticket tidak ditemukan.');
            return;
        }

        if (!note) {
            alert('Mohon isi catatan sebelum menyimpan.');
            return;
        }

        updateAdminStatus(ticketId, 'Diproses', note);
    });
}

function initExport() {
    const btns = document.querySelectorAll('.btn-export');
    btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            showToast('Menyiapkan laporan untuk diunduh...', 'info');
        });
    });
}

function initWhitelistAdd() {
    const btns = document.querySelectorAll('.btn-add-whitelist');
    btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            const type = btn.getAttribute('data-type') || 'item';
            const val = prompt('Masukkan ' + type + ' baru:');
            if (val && val.trim()) {
                showToast('"' + val.trim() + '" berhasil ditambahkan ke whitelist.', 'success');
            }
        });
    });
}

function initWhitelistDelete() {
    const btns = document.querySelectorAll('.btn-delete-whitelist');
    btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            const row = btn.closest('div[data-whitelist-row]') || btn.closest('.whitelist-row');
            if (confirm('Hapus item ini dari whitelist?')) {
                if (row) row.remove();
                showToast('Item berhasil dihapus dari whitelist.', 'success');
            }
        });
    });
}

function initEducationCMS() {
    document.querySelectorAll('.btn-edit-article').forEach(function (btn) {
        btn.addEventListener('click', function () {
            showToast('Membuka editor artikel...', 'info');
        });
    });

    document.querySelectorAll('.btn-delete-article').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const row = btn.closest('tr');
            if (confirm('Hapus artikel ini secara permanen?')) {
                if (row) row.remove();
                showToast('Artikel berhasil dihapus.', 'success');
            }
        });
    });

    const btnTambah = document.getElementById('btn-tambah-artikel');
    if (btnTambah) {
        btnTambah.addEventListener('click', function () {
            showToast('Membuka form tambah artikel baru...', 'info');
        });
    }
}

function showToast(message, type) {
    const existing = document.getElementById('admin-toast');
    if (existing) existing.remove();

    const colors = {
        success: 'bg-emerald-600',
        info: 'bg-slate-800',
        error: 'bg-red-600',
    };

    const toast = document.createElement('div');
    toast.id = 'admin-toast';
    toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] ' + (colors[type] || colors.info) + ' text-white px-6 py-3 rounded-xl shadow-xl text-sm font-semibold transition-all';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () { toast.remove(); }, 400);
    }, 3000);
}

document.addEventListener('DOMContentLoaded', function () {
    loadAdminSummary();
    loadAdminReports();
    loadCaseReviewDetail();
    initPhishingDecision();
    initEscalation();
    initMarkSafe();
    initSaveNote();
    initExport();
    initWhitelistAdd();
    initWhitelistDelete();
    initEducationCMS();
});