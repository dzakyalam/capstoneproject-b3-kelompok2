from flask import Flask, request, jsonify, render_template, redirect, url_for, session
import os
import re
import csv
import uuid
import joblib
import pymysql
import numpy as np
import hashlib
from datetime import datetime
from urllib.parse import urlparse
from scipy.sparse import hstack, csr_matrix
from pymysql.cursors import DictCursor


# =========================================================
# INISIALISASI APLIKASI FLASK
# =========================================================
# Bagian ini membuat aplikasi Flask utama.
# app.secret_key dipakai untuk session login admin.
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "cimb-guardian-secret-key")

# BASE_DIR = folder tempat file app.py berada.
# Ini dipakai supaya file seperti model .pkl dan CSV whitelist
# bisa dibaca dengan path yang stabil.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# =========================================================
# KONFIGURASI DATABASE MYSQL
# =========================================================
# Sesuaikan dengan MySQL XAMPP kamu:
# - host = 127.0.0.1
# - port = 3307
# - user = root
# - password = kosong
# - database = cimb_guardian
DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3307,
    "user": "root",
    "password": "",
    "database": "cimb_guardian",
    "cursorclass": DictCursor,
    "autocommit": True,
}


# =========================================================
# LOAD MODEL NLP
# =========================================================
# Bagian ini mencoba memuat model machine learning untuk analisis phishing.
# Jika file model gagal dibaca, sistem masih tetap bisa jalan dengan fallback rule-based.
TFIDF_VECTORIZER = None
NLP_MODEL = None
NLP_METADATA = None

try:
    TFIDF_VECTORIZER = joblib.load(os.path.join(BASE_DIR, "tfidf_vectorizer.pkl"))
    NLP_MODEL = joblib.load(os.path.join(BASE_DIR, "nlp_model.pkl"))
    NLP_METADATA = joblib.load(os.path.join(BASE_DIR, "metadata.pkl"))
    print("[OK] Model NLP berhasil dimuat.")
except Exception as e:
    print("[WARNING] Model NLP gagal dimuat:", e)


# =========================================================
# FUNGSI KONEKSI DATABASE
# =========================================================
# Fungsi ini dipakai untuk membuat koneksi ke MySQL.
# with_db=False dipakai saat database belum ada dan kita baru mau create database.
def get_conn(with_db: bool = True):
    config = DB_CONFIG.copy()
    if not with_db:
        config.pop("database", None)
    return pymysql.connect(**config)


# =========================================================
# HASH PASSWORD ADMIN
# =========================================================
# Password admin disimpan dalam bentuk hash SHA256 supaya lebih aman
# dibanding menyimpan plain text.
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


# =========================================================
# NORMALISASI NOMOR TELEPON
# =========================================================
# Fungsi ini merapikan format nomor telepon:
# - menghapus simbol yang tidak perlu
# - mengubah 08xxxx menjadi +628xxxx
# - mengubah 62xxxx menjadi +62xxxx
def normalize_phone(phone: str) -> str:
    phone = re.sub(r"[^\d+]", "", str(phone).strip())

    if not phone:
        return ""

    # jika nomor dalam format scientific notation dari Excel, abaikan
    # nanti bisa diperbaiki manual di CSV
    if "e+" in phone.lower():
        return ""

    if phone.startswith("08"):
        return "+62" + phone[1:]
    if phone.startswith("62"):
        return "+" + phone
    return phone


# =========================================================
# IMPORT WHITELIST DARI FILE CSV
# =========================================================
# Fungsi ini membaca file Whitelist_CIMB_Official.csv dari folder project.
# Lalu:
# - type=domain  -> masuk ke tabel whitelist_domains
# - type=phone   -> masuk ke tabel whitelist_phones
#
# File CSV harus memiliki kolom:
# - type
# - value
def import_whitelist_from_csv():
    csv_path = os.path.join(BASE_DIR, "Whitelist_CIMB_Official.csv")

    if not os.path.exists(csv_path):
        print("[WARNING] File Whitelist_CIMB_Official.csv tidak ditemukan.")
        return

    imported_domains = 0
    imported_phones = 0

    with get_conn() as conn:
        with conn.cursor() as cur:
            with open(csv_path, mode="r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)

                for row in reader:
                    item_type = str(row.get("type", "")).strip().lower()
                    value = str(row.get("value", "")).strip()

                    if not item_type or not value:
                        continue

                    if item_type == "domain":
                        cur.execute(
                            "INSERT IGNORE INTO whitelist_domains(domain) VALUES (%s)",
                            (value,)
                        )
                        imported_domains += 1

                    elif item_type == "phone":
                        phone_value = normalize_phone(value)
                        if not phone_value:
                            continue

                        cur.execute(
                            "INSERT IGNORE INTO whitelist_phones(phone) VALUES (%s)",
                            (phone_value,)
                        )
                        imported_phones += 1

    print(f"[OK] Whitelist CSV berhasil diproses. Domain: {imported_domains}, Phone: {imported_phones}")


# =========================================================
# INIT DATABASE DAN TABEL
# =========================================================
# Fungsi ini:
# 1. membuat database jika belum ada
# 2. membuat tabel utama project
# 3. menambah kolom jika project lama belum punya
# 4. seed data default
# 5. import whitelist dari CSV
def init_db():
    # Buat database jika belum ada
    with get_conn(with_db=False) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "CREATE DATABASE IF NOT EXISTS cimb_guardian "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )

    # Buat tabel jika belum ada
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Tabel admin
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admins (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(100) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'admin',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Tabel laporan user
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reports (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    ticket_id VARCHAR(30) NOT NULL UNIQUE,
                    reporter_email VARCHAR(255) NULL,
                    message_text TEXT NOT NULL,
                    extracted_urls TEXT NULL,
                    extracted_phones TEXT NULL,
                    url_flag TINYINT(1) NOT NULL DEFAULT 0,
                    phone_flag TINYINT(1) NOT NULL DEFAULT 0,
                    nlp_prob DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
                    ai_extra_score DECIMAL(8,2) NOT NULL DEFAULT 0.00,
                    risk_score INT NOT NULL DEFAULT 0,
                    risk_level VARCHAR(30) NOT NULL DEFAULT 'Low Risk',
                    admin_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
                    admin_note TEXT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_reports_ticket (ticket_id),
                    INDEX idx_reports_status (admin_status),
                    INDEX idx_reports_created (created_at)
                )
            """)

            # Tabel whitelist domain
            cur.execute("""
                CREATE TABLE IF NOT EXISTS whitelist_domains (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    domain VARCHAR(255) NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Tabel whitelist nomor telepon
            cur.execute("""
                CREATE TABLE IF NOT EXISTS whitelist_phones (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    phone VARCHAR(30) NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Tambah kolom reporter_email jika project lama belum punya
            try:
                cur.execute("SHOW COLUMNS FROM reports LIKE 'reporter_email'")
                has_column = cur.fetchone()
                if not has_column:
                    cur.execute("ALTER TABLE reports ADD COLUMN reporter_email VARCHAR(255) NULL AFTER ticket_id")
            except Exception as e:
                print("[WARNING] Gagal memastikan kolom reporter_email:", e)

            # Seed admin default
            cur.execute(
                "INSERT IGNORE INTO admins(username, password_hash, role) VALUES (%s, %s, %s)",
                ("admin", hash_password("admin123"), "admin")
            )

            # Seed fallback whitelist domain
            fallback_domains = [
                "cimbniaga.co.id",
                "www.cimbniaga.co.id",
                "octoclicks.co.id",
                "www.octoclicks.co.id",
                "cimbclicks.co.id",
            ]
            for domain in fallback_domains:
                cur.execute(
                    "INSERT IGNORE INTO whitelist_domains(domain) VALUES (%s)",
                    (domain,)
                )

            # Seed fallback whitelist phone
            fallback_phones = [
                "14041",
                "1500800",
                "+622114041",
                "+62211500800",
                "+62811880055",
            ]
            for phone in fallback_phones:
                cur.execute(
                    "INSERT IGNORE INTO whitelist_phones(phone) VALUES (%s)",
                    (phone,)
                )

    # Import whitelist dari CSV
    import_whitelist_from_csv()


# =========================================================
# GENERATE TICKET ID
# =========================================================
# Membuat ID tiket unik seperti:
# CG-2026-ABCDE
def generate_ticket_id():
    return "CG-" + datetime.now().strftime("%Y") + "-" + uuid.uuid4().hex[:5].upper()


# =========================================================
# EKSTRAK URL DAN NOMOR DARI TEKS
# =========================================================
# Fungsi ini mencari:
# - URL/domain dari pesan
# - nomor telepon dari pesan
def extract_entities(text: str):
    text = str(text or "")
    url_pattern = r'(https?://[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.(?:co\.id|com|id|net|org|biz|site|info|xyz|top)(?:/[^\s]*)?)'
    phone_pattern = r'(\+62[\d\-\s]{8,20}|08[\d\-\s]{8,20})'

    urls = list(dict.fromkeys(re.findall(url_pattern, text)))

    raw_phones = re.findall(phone_pattern, text)
    phones = [normalize_phone(p) for p in raw_phones]
    phones = [p for p in phones if p]
    phones = list(dict.fromkeys(phones))

    return urls, phones

# =========================================================
# EKSTRAK DOMAIN DARI URL
# =========================================================
# Fungsi ini mengambil nama domain dari URL
# contoh:
# https://abc.com/login -> abc.com
def extract_domain(url: str):
    url = str(url or "").strip()

    if not url.startswith("http://") and not url.startswith("https://"):
        url = "http://" + url

    parsed = urlparse(url)
    netloc = parsed.netloc.lower()

    if netloc.startswith("www."):
        netloc = netloc[4:]

    return netloc


# =========================================================
# CEK WHITELIST DOMAIN
# =========================================================
# Mengecek apakah domain ada di database whitelist_domains
def is_domain_whitelisted(domain: str) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM whitelist_domains WHERE LOWER(domain)=LOWER(%s) LIMIT 1",
                (domain,)
            )
            return cur.fetchone() is not None


# =========================================================
# CEK WHITELIST PHONE
# =========================================================
# Mengecek apakah nomor ada di database whitelist_phones
def is_phone_whitelisted(phone: str) -> bool:
    phone = normalize_phone(phone)
    if not phone:
        return False

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM whitelist_phones WHERE phone=%s LIMIT 1",
                (phone,)
            )
            return cur.fetchone() is not None


# =========================================================
# FITUR MANUAL UNTUK MODEL NLP
# =========================================================
# Fitur tambahan ini dipakai untuk membantu model NLP membaca pola:
# - kata urgensi
# - kata hadiah
# - kata perbankan
# - jumlah URL
# - jumlah nomor
def build_manual_features(text: str, urls=None, phones=None):
    if urls is None:
        urls = []
    if phones is None:
        phones = []

    text = str(text or "")
    text_lower = text.lower()

    urgent_words = [
        "segera", "darurat", "batas waktu", "hari ini", "malam ini",
        "cepat", "urgent", "hangus", "terakhir"
    ]

    reward_words = [
        "hadiah", "undian", "pemenang", "bonus", "klaim", "voucher", "promo"
    ]

    banking_words = [
        "akun", "bank", "rekening", "verifikasi", "otp", "pin",
        "password", "saldo", "blokir", "aktivasi"
    ]

    risky_symbols = ["http", "https", "www", ".xyz", ".top", ".site", ".info"]

    digit_count = sum(c.isdigit() for c in text)
    upper_count = sum(c.isupper() for c in text)
    exclamation_count = text.count("!")
    question_count = text.count("?")
    url_count = len(urls)
    phone_count = len(phones)
    text_len = len(text)
    word_count = len(text.split())

    urgent_count = sum(1 for w in urgent_words if w in text_lower)
    reward_count = sum(1 for w in reward_words if w in text_lower)
    banking_count = sum(1 for w in banking_words if w in text_lower)
    risky_symbol_count = sum(1 for w in risky_symbols if w in text_lower)

    has_url = 1 if url_count > 0 else 0
    has_phone = 1 if phone_count > 0 else 0
    has_money_pattern = 1 if ("rp" in text_lower or "ribu" in text_lower or "juta" in text_lower) else 0
    has_otp_pin = 1 if ("otp" in text_lower or "pin" in text_lower or "password" in text_lower) else 0
    has_deadline = 1 if ("segera" in text_lower or "batas waktu" in text_lower or "hangus" in text_lower) else 0

    return np.array([
        text_len, word_count, digit_count, upper_count, exclamation_count, question_count,
        url_count, phone_count, urgent_count, reward_count, banking_count, risky_symbol_count,
        has_url, has_phone, has_money_pattern, has_otp_pin, has_deadline
    ], dtype=float)


# =========================================================
# PREDIKSI NLP
# =========================================================
# Jika model tersedia, gunakan model.
# Jika model gagal, sistem fallback ke rule-based sederhana.
def predict_nlp_probability(text: str, urls=None, phones=None) -> float:
    if urls is None:
        urls = []
    if phones is None:
        phones = []

    text = str(text or "")

    if NLP_MODEL is not None and TFIDF_VECTORIZER is not None:
        try:
            tfidf_features = TFIDF_VECTORIZER.transform([text])
            manual_features = build_manual_features(text, urls, phones).reshape(1, -1)
            x_final = hstack([tfidf_features, csr_matrix(manual_features)])
            prob = NLP_MODEL.predict_proba(x_final)[0][1]
            return float(prob)
        except Exception as e:
            print("[WARNING] Prediksi model NLP gagal, fallback ke rule-based:", e)

    text_lower = text.lower()
    danger_phrases = [
        "akun diblokir", "segera", "verifikasi sekarang", "klik link",
        "hadiah", "undian", "klaim hadiah", "otp", "pin",
        "transfer sekarang", "batas waktu", "darurat", "rekening",
        "bank", "kode verifikasi", "hubungi", "sebelum hangus"
    ]

    hit = sum(1 for phrase in danger_phrases if phrase in text_lower)

    if hit >= 6:
        return 0.95
    if hit == 5:
        return 0.85
    if hit == 4:
        return 0.70
    if hit == 3:
        return 0.55
    if hit == 2:
        return 0.35
    if hit == 1:
        return 0.18
    return 0.05


# =========================================================
# SKOR AI TAMBAHAN
# =========================================================
# Skor tambahan berbasis aturan:
# - ada kata-kata rawan
# - ada domain aneh
# - ada link shortener
def extra_ai_score(text: str) -> float:
    text = str(text or "").strip().lower()
    if not text:
        return 0.0

    score = 0.0

    for keyword in [
        "http", "https", "klik", "link", "login",
        "otp", "pin", "rekening", "verifikasi", "hadiah"
    ]:
        if keyword in text:
            score += 8

    if any(domain in text for domain in [".xyz", ".biz", ".site", ".info", ".top", ".click"]):
        score += 20

    if "bit.ly" in text or "tinyurl" in text or "shorturl" in text:
        score += 20

    return min(score, 100.0)


# =========================================================
# ANALISIS PESAN
# =========================================================
# Ini fungsi inti sistem:
# 1. ekstrak URL dan nomor
# 2. cek whitelist
# 3. hitung probabilitas NLP
# 4. hitung risk score
# 5. buat ringkasan, indikator, dan rekomendasi
def analyze_message(text: str):
    text = str(text or "")
    urls, phones = extract_entities(text)

    url_flag = 0
    phone_flag = 0
    url_untrusted = []
    phone_untrusted = []

    for url in urls:
        domain = extract_domain(url)
        if domain and not is_domain_whitelisted(domain):
            url_flag = 1
            url_untrusted.append(domain)

    for phone in phones:
        if not is_phone_whitelisted(phone):
            phone_flag = 1
            phone_untrusted.append(phone)

    nlp_prob = predict_nlp_probability(text, urls, phones)
    ai_score = extra_ai_score(text)

    score = 0
    if url_flag:
        score += 30
    if phone_flag:
        score += 30
    score += int(nlp_prob * 40)
    score = min(score, 100)

    if ai_score >= 60 and score < 70:
        score = min(100, score + 10)

    if score >= 70:
        risk_level = "High Risk"
        summary = "Pesan ini terindikasi kuat sebagai phishing atau penipuan digital."
    elif score >= 40:
        risk_level = "Medium Risk"
        summary = "Pesan ini mencurigakan dan perlu diwaspadai sebelum melakukan tindakan apa pun."
    else:
        risk_level = "Low Risk"
        summary = "Pesan ini relatif lebih aman, tetapi tetap perlu diperiksa dengan hati-hati."

    indicators = []
    recommendations = []

    if url_flag:
        indicators.append({
            "title": "URL mencurigakan ditemukan",
            "description": "Domain tidak terdaftar pada whitelist resmi."
        })
        recommendations.append("Jangan klik tautan yang ada di dalam pesan.")

    if phone_flag:
        indicators.append({
            "title": "Nomor telepon tidak dikenal",
            "description": "Nomor tidak ditemukan dalam database resmi."
        })
        recommendations.append("Jangan hubungi atau membalas nomor tersebut.")

    if nlp_prob >= 0.30:
        indicators.append({
            "title": "Bahasa mengandung pola manipulatif",
            "description": "Terdapat unsur urgensi, ancaman, hadiah, atau permintaan data sensitif."
        })
        recommendations.append("Jangan berikan OTP, PIN, password, atau data pribadi.")

    if not indicators:
        indicators.append({
            "title": "Tidak ada indikator kuat",
            "description": "Sistem tidak menemukan sinyal phishing yang dominan."
        })
        recommendations.append("Tetap verifikasi ke kanal resmi bila masih ragu.")

    return {
        "message_text": text,
        "urls": urls,
        "phones": phones,
        "url_flag": url_flag,
        "phone_flag": phone_flag,
        "url_untrusted": url_untrusted,
        "phone_untrusted": phone_untrusted,
        "nlp_prob": round(nlp_prob, 4),
        "ai_extra_score": round(ai_score, 2),
        "risk_score": score,
        "risk_level": risk_level,
        "summary": summary,
        "indicators": indicators,
        "recommendations": recommendations,
    }


# =========================================================
# CEK SESSION ADMIN
# =========================================================
# Fungsi sederhana untuk mengecek apakah admin sedang login.
def require_admin():
    return session.get("admin_logged_in") is True


# =========================================================
# USER PAGES
# =========================================================
# Route halaman frontend user.
@app.route("/")
@app.route("/index.html")
def home():
    return render_template("user/index.html")


@app.route("/result.html")
def result_page():
    return render_template("user/result.html")


@app.route("/success.html")
def success_page():
    return render_template("user/success.html")


@app.route("/track.html")
def track_page():
    return render_template("user/track.html")


@app.route("/education.html")
def education_page():
    return render_template("user/education.html")


# =========================================================
# ADMIN LOGIN
# =========================================================
# GET  -> tampilkan form login admin
# POST -> proses autentikasi admin
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "GET":
        return render_template("admin/login.html")

    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"status": "error", "message": "Username dan password wajib diisi"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM admins WHERE username=%s LIMIT 1", (username,))
            admin = cur.fetchone()

    if not admin or admin["password_hash"] != hash_password(password):
        return jsonify({"status": "error", "message": "Username atau password salah"}), 401

    session["admin_logged_in"] = True
    session["admin_username"] = admin["username"]
    session["admin_role"] = admin.get("role", "admin")

    return jsonify({
        "status": "success",
        "message": "Login berhasil",
        "redirect": url_for("admin_dashboard")
    })


# =========================================================
# ADMIN LOGOUT
# =========================================================
# Menghapus session admin lalu kembali ke login.
@app.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("admin_login"))


# =========================================================
# ADMIN PAGES
# =========================================================
# Halaman-halaman admin.
# Semua halaman admin wajib login dulu.
@app.route("/admin")
@app.route("/admin/dashboard")
@app.route("/admin/dashboard.html")
def admin_dashboard():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/dashboard.html")


@app.route("/admin/analytics")
@app.route("/admin/analytics.html")
def admin_analytics():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/analytics.html")


@app.route("/admin/case-review")
@app.route("/admin/case-review.html")
def admin_case_review():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/case-review.html")


@app.route("/admin/education-cms")
@app.route("/admin/education-cms.html")
def admin_education_cms():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/education-cms.html")


# =========================================================
# USER API
# =========================================================
# API untuk analisa pesan dari user.
@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    try:
        data = request.get_json(silent=True) or {}
        message_text = str(data.get("message_text") or "").strip()

        if not message_text:
            return jsonify({"message": "Pesan wajib diisi"}), 400

        return jsonify(analyze_message(message_text)), 200

    except Exception as e:
        return jsonify({"message": f"Terjadi error: {str(e)}"}), 500


# API untuk menyimpan laporan user ke database.
@app.route("/api/report", methods=["POST"])
def api_report():
    try:
        data = request.get_json(silent=True) or {}
        message_text = str(data.get("message_text") or "").strip()
        reporter_email = str(data.get("email") or "").strip()

        if not message_text:
            return jsonify({"message": "Pesan wajib diisi"}), 400

        analysis = analyze_message(message_text)
        ticket_id = generate_ticket_id()

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO reports (
                        ticket_id, reporter_email, message_text, extracted_urls, extracted_phones,
                        url_flag, phone_flag, nlp_prob, ai_extra_score, risk_score,
                        risk_level, admin_status, admin_note
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        ticket_id,
                        reporter_email if reporter_email else None,
                        analysis["message_text"],
                        ", ".join(analysis["urls"]),
                        ", ".join(analysis["phones"]),
                        analysis["url_flag"],
                        analysis["phone_flag"],
                        analysis["nlp_prob"],
                        analysis["ai_extra_score"],
                        analysis["risk_score"],
                        analysis["risk_level"],
                        "Pending",
                        "Laporan telah diterima dan akan diverifikasi oleh admin.",
                    ),
                )

        return jsonify({
            "message": "Laporan berhasil dikirim",
            "ticket_id": ticket_id,
            "risk_score": analysis["risk_score"],
            "risk_level": analysis["risk_level"],
        }), 200

    except Exception as e:
        return jsonify({"message": f"Terjadi error: {str(e)}"}), 500


# API untuk tracking tiket user berdasarkan ticket_id.
@app.route("/api/ticket/<ticket_id>", methods=["GET"])
def api_ticket(ticket_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM reports WHERE ticket_id=%s LIMIT 1", (ticket_id,))
            row = cur.fetchone()

    if not row:
        return jsonify({"message": "Ticket tidak ditemukan"}), 404

    return jsonify(row), 200


# =========================================================
# ADMIN API
# =========================================================
# API untuk mengambil semua laporan ke dashboard admin.
@app.route("/admin/reports", methods=["GET"])
def admin_reports():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id,
                    ticket_id,
                    reporter_email,
                    message_text,
                    extracted_urls,
                    extracted_phones,
                    url_flag,
                    phone_flag,
                    nlp_prob,
                    ai_extra_score,
                    risk_score,
                    risk_level,
                    admin_status,
                    admin_note,
                    created_at,
                    updated_at
                FROM reports
                ORDER BY created_at DESC
            """)
            rows = cur.fetchall()

    return jsonify(rows), 200


# API untuk mengambil detail satu laporan berdasarkan ticket_id.
@app.route("/admin/report/<ticket_id>", methods=["GET"])
def admin_get_report(ticket_id):
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM reports WHERE ticket_id=%s LIMIT 1", (ticket_id,))
            row = cur.fetchone()

    if not row:
        return jsonify({"message": "Ticket tidak ditemukan"}), 404

    return jsonify(row), 200


# API untuk mengubah status dan catatan admin.
@app.route("/admin/report/<ticket_id>", methods=["PUT"])
def admin_update_report(ticket_id):
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    admin_status = str(data.get("admin_status") or "").strip()
    admin_note = str(data.get("admin_note") or "").strip()

    allowed_status = ["Pending", "Diproses", "Fraud", "Aman"]
    if admin_status not in allowed_status:
        return jsonify({"message": "Status admin tidak valid"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE reports SET admin_status=%s, admin_note=%s WHERE ticket_id=%s",
                (admin_status, admin_note, ticket_id),
            )

            if cur.rowcount == 0:
                return jsonify({"message": "Ticket tidak ditemukan"}), 404

    return jsonify({
        "message": "Perubahan berhasil disimpan. Status laporan dan catatan admin telah diperbarui."
    }), 200


# API ringkasan untuk kartu dashboard admin.
@app.route("/admin/summary", methods=["GET"])
def admin_summary():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS total_reports FROM reports")
            total_reports = cur.fetchone()["total_reports"]

            cur.execute("SELECT COUNT(*) AS pending_reports FROM reports WHERE admin_status='Pending'")
            pending_reports = cur.fetchone()["pending_reports"]

            cur.execute("SELECT COUNT(*) AS fraud_reports FROM reports WHERE admin_status='Fraud'")
            fraud_reports = cur.fetchone()["fraud_reports"]

            cur.execute("SELECT COUNT(*) AS aman_reports FROM reports WHERE admin_status='Aman'")
            aman_reports = cur.fetchone()["aman_reports"]

            cur.execute("SELECT COUNT(*) AS high_risk_reports FROM reports WHERE risk_level='High Risk'")
            high_risk_reports = cur.fetchone()["high_risk_reports"]

    return jsonify({
        "total_reports": total_reports,
        "pending_reports": pending_reports,
        "fraud_reports": fraud_reports,
        "aman_reports": aman_reports,
        "high_risk_reports": high_risk_reports,
    }), 200


# Alias route logs ke daftar laporan admin.
@app.route("/logs", methods=["GET"])
def admin_logs_alias():
    return admin_reports()


# =========================================================
# HEALTH CHECK
# =========================================================
# Route sederhana untuk memastikan backend hidup.
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "app": "cimb_guardian",
        "time": datetime.now().isoformat()
    }), 200


# =========================================================
# ENTRY POINT
# =========================================================
# Saat file dijalankan langsung:
# - inisialisasi database
# - import whitelist
# - jalankan Flask
if __name__ == "__main__":
    init_db()
    app.run(debug=True)