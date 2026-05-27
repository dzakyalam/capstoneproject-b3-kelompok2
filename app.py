from flask import Flask, request, jsonify, render_template, redirect, url_for, session, Response
import os
import re
import csv
import uuid
import joblib
import pymysql
import numpy as np
import hashlib
import smtplib
import json
from datetime import datetime, timedelta
from urllib.parse import urlparse
from scipy.sparse import hstack, csr_matrix
from pymysql.cursors import DictCursor
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


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
# KONFIGURASI GMAIL SMTP
# =========================================================
# Jangan hardcode email/password asli di app.py.
# Gunakan environment variable supaya aman saat push ke GitHub.
MAIL_USERNAME = os.getenv("MAIL_USERNAME", "")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "")
MAIL_SENDER_NAME = os.getenv("MAIL_SENDER_NAME", "CIMB Guardian")
MAIL_SMTP_HOST = os.getenv("MAIL_SMTP_HOST", "smtp.gmail.com")
MAIL_SMTP_PORT = int(os.getenv("MAIL_SMTP_PORT", "587"))

# =========================================================
# KONFIGURASI DATABASE MYSQL
# =========================================================

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3307")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "cimb_guardian"),
    "cursorclass": DictCursor,
    "autocommit": True,
}
if os.getenv("DB_SSL", "").lower() in ["true", "1", "required"]:
    DB_CONFIG["ssl"] = {}
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
# KIRIM EMAIL NOTIFIKASI
# =========================================================
def send_email_notification(to_email: str, subject: str, html_body: str, text_body: str = "") -> bool:
    to_email = str(to_email or "").strip()

    if not to_email:
        print("[EMAIL] Email tujuan kosong. Notifikasi tidak dikirim.")
        return False

    if not MAIL_USERNAME or not MAIL_PASSWORD:
        print("[EMAIL] MAIL_USERNAME atau MAIL_PASSWORD belum dikonfigurasi.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{MAIL_SENDER_NAME} <{MAIL_USERNAME}>"
        msg["To"] = to_email

        if not text_body:
            text_body = re.sub(r"<[^>]+>", "", html_body)

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP(MAIL_SMTP_HOST, MAIL_SMTP_PORT) as server:
            server.starttls()
            server.login(MAIL_USERNAME, MAIL_PASSWORD)
            server.sendmail(MAIL_USERNAME, [to_email], msg.as_string())

        print(f"[EMAIL] Notifikasi berhasil dikirim ke {to_email}")
        return True

    except Exception as e:
        print("[EMAIL] Gagal mengirim email:", e)
        return False


def build_ticket_created_email(ticket_id: str, risk_score: int, risk_level: str):
    subject = f"CIMB Guardian - Laporan diterima ({ticket_id})"

    html = f"""
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
        <h2 style="color: #b5000b;">CIMB Guardian</h2>

        <p>Laporan Anda telah diterima dan sedang menunggu verifikasi admin.</p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p><strong>ID Tiket:</strong> {ticket_id}</p>
            <p><strong>Skor Risiko:</strong> {risk_score}%</p>
            <p><strong>Level Risiko:</strong> {risk_level}</p>
            <p><strong>Status:</strong> Pending</p>
        </div>

        <p>Gunakan ID tiket ini untuk melacak status laporan Anda di halaman Lacak Tiket.</p>

        <p style="font-size: 12px; color: #64748b;">
            Jangan pernah membagikan OTP, PIN, password, CVV, atau data rahasia kepada siapa pun.
        </p>
    </div>
    """

    text = f"""
CIMB Guardian

Laporan Anda telah diterima.

ID Tiket: {ticket_id}
Skor Risiko: {risk_score}%
Level Risiko: {risk_level}
Status: Pending

Gunakan ID tiket ini untuk melacak status laporan Anda di halaman Lacak Tiket.
"""

    return subject, html, text


def build_status_updated_email(ticket_id: str, status: str, note: str):
    subject = f"CIMB Guardian - Status tiket {ticket_id} diperbarui"

    html = f"""
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
        <h2 style="color: #b5000b;">CIMB Guardian</h2>

        <p>Status laporan Anda telah diperbarui oleh admin.</p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p><strong>ID Tiket:</strong> {ticket_id}</p>
            <p><strong>Status Baru:</strong> {status}</p>
            <p><strong>Catatan Admin:</strong> {note or "-"}</p>
        </div>

        <p>Silakan cek halaman Lacak Tiket untuk melihat detail pembaruan.</p>
    </div>
    """

    text = f"""
CIMB Guardian

Status laporan Anda telah diperbarui.

ID Tiket: {ticket_id}
Status Baru: {status}
Catatan Admin: {note or "-"}

Silakan cek halaman Lacak Tiket untuk melihat detail pembaruan.
"""

    return subject, html, text
# =========================================================
# NORMALISASI NOMOR TELEPON
# =========================================================
# Fungsi ini merapikan format nomor telepon:
# - menghapus simbol yang tidak perlu
# - mengubah 08xxxx menjadi +628xxxx
# - mengubah 62xxxx menjadi +62xxxx
def normalize_phone(phone: str) -> str:
    raw_phone = str(phone).strip()

    if not raw_phone:
        return ""

    if "e+" in raw_phone.lower():
        return ""

    phone = re.sub(r"[^\d+]", "", raw_phone)

    if not phone:
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

def seed_pdf_education_materials():
    materials = [
        {
            "title": "Jangan Tersangkut! Mengenali Phishing & Situs Palsu",
            "category": "Phishing",
            "summary": "Pelajari cara mengenali pesan phishing, situs palsu, URL mencurigakan, dan langkah aman saat menerima tautan dari SMS, email, atau WhatsApp.",
            "read_time": "7 mnt baca",
            "image_url": "",
            "content": """
MODUL 1 — Jangan Tersangkut! Mengenali Phishing & Situs Palsu

Apa itu Phishing?
Phishing adalah upaya penipuan di mana pelaku menyamar sebagai pihak terpercaya seperti bank, pemerintah, atau marketplace untuk memancing korban agar menyerahkan data pribadi.

Bagaimana Cara Kerjanya?
Pelaku biasanya mengirim pesan melalui SMS, email, atau WhatsApp yang tampak resmi. Pesan tersebut sering berisi ancaman seperti akun diblokir atau iming-iming hadiah. Di dalamnya terdapat tautan yang mengarah ke situs palsu.

PERINGATAN:
CIMB Niaga tidak pernah meminta username, password, PIN, atau OTP melalui SMS, email, WhatsApp, maupun telepon.

Langkah Praktis:
1. Selalu periksa URL resmi CIMB Niaga, yaitu cimbniaga.co.id.
2. Jangan klik tautan dari SMS atau WhatsApp yang mengatasnamakan bank.
3. Akses layanan melalui aplikasi OCTO Mobile atau ketik URL resmi langsung.
4. Jika ragu, hubungi CIMB Care di 14041.
5. Waspadai domain mirip seperti cimb-niaga-login.com atau cimb.promo-hadiah.net.
"""
        },
        {
            "title": "Kode Sakti yang Harus Dijaga: Rahasia OTP Anda",
            "category": "OTP",
            "summary": "Pahami mengapa OTP sangat penting, bagaimana penipu mencoba mendapatkannya, dan langkah aman menjaga kode verifikasi perbankan.",
            "read_time": "6 mnt baca",
            "image_url": "",
            "content": """
MODUL 2 — Kode Sakti yang Harus Dijaga: Rahasia OTP Anda

Apa itu OTP?
OTP atau One-Time Password adalah kode verifikasi yang dikirim ke nomor ponsel dan hanya berlaku satu kali dalam waktu singkat. OTP digunakan sebagai lapisan keamanan tambahan.

Mengapa OTP Sangat Berharga?
OTP adalah pertahanan terakhir rekening Anda. Karena itu, penipu sering berpura-pura menjadi petugas bank, kurir, atau pihak resmi untuk meminta OTP.

PERINGATAN:
Tidak ada petugas bank, kurir, atau instansi resmi yang berhak meminta OTP Anda.

Langkah Praktis:
1. Jangan pernah menyebutkan OTP kepada siapa pun.
2. Gunakan OTP hanya di aplikasi OCTO Mobile atau website resmi.
3. Jika menerima OTP padahal tidak sedang transaksi, segera hubungi CIMB Care 14041.
4. Jangan mengetik OTP di form dari tautan WhatsApp, SMS, atau email.
5. Pastikan nomor ponsel yang terdaftar masih aktif.
"""
        },
        {
            "title": "Hati-hati Undangan Digital! Bahaya File APK Palsu",
            "category": "Malware APK",
            "summary": "Kenali bahaya file APK palsu yang menyamar sebagai undangan, paket kurir, atau aplikasi lain untuk mencuri OTP dan data perbankan.",
            "read_time": "6 mnt baca",
            "image_url": "",
            "content": """
MODUL 3 — Hati-hati Undangan Digital! Bahaya File APK Palsu

Apa itu File APK Berbahaya?
APK adalah format file instalasi aplikasi Android. File APK berbahaya dapat mencuri data dari ponsel, termasuk SMS, OTP, kontak, dan login perbankan.

Bagaimana Cara Kerjanya?
Korban menerima file APK melalui WhatsApp, SMS, atau email. Jika diinstal, aplikasi dapat meminta akses SMS dan kontak. Dari situ, pelaku bisa membaca OTP yang masuk.

PERINGATAN:
Undangan asli dan informasi paket tidak pernah dikirim dalam format APK.

Langkah Praktis:
1. Jangan pernah menginstal APK dari WhatsApp, SMS, atau email.
2. Instal aplikasi hanya dari Google Play Store atau App Store resmi.
3. Nonaktifkan install aplikasi dari sumber tidak dikenal.
4. Periksa izin aplikasi sebelum menginstal.
5. Jika terlanjur menginstal APK mencurigakan, aktifkan mode pesawat, hapus aplikasi, ganti password, dan hubungi bank.
"""
        },
        {
            "title": "Scan dengan Bijak: Ancaman Quishing lewat QR Code Palsu",
            "category": "Quishing",
            "summary": "Pelajari modus QR code palsu, cara memeriksa QRIS, dan langkah aman sebelum membuka tautan hasil scan QR.",
            "read_time": "6 mnt baca",
            "image_url": "",
            "content": """
MODUL 4 — Scan dengan Bijak: Ancaman Quishing lewat QR Code Palsu

Apa itu Quishing?
Quishing adalah gabungan dari QR code dan phishing. Modus ini menggunakan QR code palsu yang mengarahkan korban ke situs berbahaya.

Bagaimana Cara Kerjanya?
Pelaku dapat menempelkan QR code palsu di atas QR resmi, misalnya di meja kasir, flyer pembayaran, atau pamflet promosi. Setelah dipindai, korban diarahkan ke situs phishing atau pembayaran ke rekening penipu.

PERINGATAN:
Selalu periksa URL yang muncul setelah memindai QR code sebelum menekan tombol Buka atau Lanjutkan.

Langkah Praktis:
1. Periksa kondisi fisik QR code.
2. Setelah memindai, baca URL yang muncul sebelum membuka.
3. Gunakan fitur QRIS resmi di aplikasi OCTO Mobile.
4. Hindari memindai QR code dari flyer atau poster yang tidak jelas.
5. Jika QR meminta login perbankan padahal hanya untuk bayar makanan, abaikan.
"""
        },
    ]

    with get_conn() as conn:
        with conn.cursor() as cur:
            for item in materials:
                cur.execute(
                    "SELECT id FROM education_articles WHERE title=%s LIMIT 1",
                    (item["title"],)
                )
                exists = cur.fetchone()

                if exists:
                    continue

                cur.execute("""
                    INSERT INTO education_articles
                    (title, category, summary, content, status, read_time, image_url)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    item["title"],
                    item["category"],
                    item["summary"],
                    item["content"],
                    "Published",
                    item["read_time"],
                    item["image_url"],
                ))

    print("[OK] Materi edukasi dari PDF berhasil dimasukkan.")

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
    db_name = os.getenv("DB_NAME", "cimb_guardian")

    with get_conn(with_db=False) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
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

            # Tabel artikel edukasi
            cur.execute("""
                CREATE TABLE IF NOT EXISTS education_articles (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    category VARCHAR(100) NOT NULL,
                    summary TEXT NOT NULL,
                    content TEXT NOT NULL,
                    status VARCHAR(30) NOT NULL DEFAULT 'Draft',
                    read_time VARCHAR(30) NOT NULL DEFAULT '5 mnt baca',
                    image_url TEXT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            """)

            # Tambah kolom reporter_email jika project lama belum punya
                       # Tambah kolom reporter_email jika project lama belum punya
            try:
                cur.execute("SHOW COLUMNS FROM reports LIKE 'reporter_email'")
                has_column = cur.fetchone()
                if not has_column:
                    cur.execute("ALTER TABLE reports ADD COLUMN reporter_email VARCHAR(255) NULL AFTER ticket_id")
            except Exception as e:
                print("[WARNING] Gagal memastikan kolom reporter_email:", e)

                      # Tambah kolom source_message jika project lama belum punya
            try:
                cur.execute("SHOW COLUMNS FROM reports LIKE 'source_message'")
                has_column = cur.fetchone()

                if not has_column:
                    cur.execute("""
                        ALTER TABLE reports
                        ADD COLUMN source_message VARCHAR(50) NULL AFTER message_text
                    """)
            except Exception as e:
                print("[WARNING] Gagal memastikan kolom source_message:", e)

            # Tambah kolom quiz_data jika project lama belum punya
            try:
                cur.execute("SHOW COLUMNS FROM education_articles LIKE 'quiz_data'")
                has_column = cur.fetchone()

                if not has_column:
                    cur.execute("""
                        ALTER TABLE education_articles
                        ADD COLUMN quiz_data JSON NULL AFTER content
                    """)
            except Exception as e:
                print("[WARNING] Gagal memastikan kolom quiz_data:", e)

            # Seed admin default

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

            # Seed artikel edukasi default
            cur.execute("SELECT COUNT(*) AS total FROM education_articles")
            article_count = cur.fetchone()["total"]

            if article_count == 0:
                default_articles = [
                    (
                        "Tren penipuan terbaru",
                        "Edukasi Utama",
                        "Penipu terus memperbarui taktik mereka. Pelajari tentang skema Quishing dan penipuan berbasis AI yang sedang marak terjadi saat ini.",
                        "Materi ini membahas tren penipuan digital terbaru, termasuk phishing berbasis QR, social engineering, dan penyamaran layanan resmi.",
                        "Published",
                        "6 mnt baca",
                        "https://lh3.googleusercontent.com/aida-public/AB6AXuC5_3lQdbwHlMbZ6ev87pwhsEtLI926_FTB_9wga3wAj88jy0_ehxAvIpVEMZgXCQosVTQ-j3D_tuHd8Jc2gGiQf9ugFBYqthzZA-Za1D0XuQFmCrRr9RoB2sXAeHV1aRXMpfjXpxd7h-jBD_PRIeSMI_p7N1_EsPCPtAsLJXpJhM-c1ug1H5uWOEErYm_k4hKx0BiytODkThxdPz_a-QkAPnIHD0e77dk265r05ZffmHxGQiO8Fq1L0ezSKlN7m1tAC-r7InilK_A"
                    ),
                    (
                        "Apa itu phishing?",
                        "Keamanan Dasar",
                        "Mengenali upaya penipuan melalui email atau pesan teks yang menyamar sebagai institusi resmi untuk mencuri kredensial Anda.",
                        "Phishing adalah metode penipuan digital yang bertujuan mencuri informasi sensitif seperti username, password, OTP, atau data rekening dengan menyamar sebagai pihak resmi.",
                        "Published",
                        "4 mnt baca",
                        ""
                    ),
                    (
                        "Jangan pernah bagikan OTP",
                        "Keamanan Akun",
                        "Kode OTP adalah kunci akses terakhir Anda. Pihak bank tidak akan pernah meminta kode ini melalui media apapun.",
                        "OTP bersifat rahasia dan hanya digunakan untuk verifikasi transaksi oleh pemilik akun. Jangan pernah membagikannya kepada siapa pun.",
                        "Published",
                        "3 mnt baca",
                        ""
                    ),
                    (
                        "Peringatan layanan pelanggan palsu",
                        "Waspada Penipuan",
                        "Waspadai akun media sosial atau nomor WhatsApp tidak resmi yang mengaku sebagai Customer Service CIMB.",
                        "Pastikan Anda hanya menghubungi kanal resmi dan memverifikasi nomor atau akun layanan pelanggan sebelum berinteraksi lebih lanjut.",
                        "Published",
                        "4 mnt baca",
                        ""
                    ),
                    (
                        "Cara mengidentifikasi tautan penipuan",
                        "Tips & Trik",
                        "Langkah praktis untuk membedakan URL resmi dengan link phishing yang berbahaya sebelum Anda klik.",
                        "Periksa domain, protokol, ejaan, dan tujuan akhir tautan sebelum membuka link, terutama jika dikirim melalui pesan yang mendesak.",
                        "Published",
                        "5 mnt baca",
                        ""
                    ),
                ]

                for article in default_articles:
                    cur.execute("""
                        INSERT INTO education_articles
                        (title, category, summary, content, status, read_time, image_url)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, article)

    # Seed materi edukasi dari PDF
    seed_pdf_education_materials()

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

    # Maksimal skor dibuat 95
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


@app.route("/education-detail")
@app.route("/education-detail.html")
def education_detail_page():
    return render_template("user/education-detail.html")


@app.route("/quiz")
@app.route("/quiz.html")
def quiz_page():
    return render_template("user/quiz.html")


@app.route("/quiz-result")
@app.route("/quiz-result.html")
def quiz_result_page():
    return render_template("user/quiz-result.html")


@app.route("/bantuan.html")
def help_page():
    return render_template("user/bantuan.html")

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


@app.route("/admin/whitelist")
@app.route("/admin/whitelist.html")
def admin_whitelist():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/whitelist.html")


@app.route("/admin/education-cms")
@app.route("/admin/education-cms.html")
def admin_education_cms():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/education-cms.html")


@app.route("/admin/reports-queue")
@app.route("/admin/reports-queue.html")
def admin_reports_queue():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/reports-queue.html")


@app.route("/admin/ticket-management")
@app.route("/admin/ticket-management.html")
def admin_ticket_management():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/ticket-management.html")


@app.route("/admin/settings")
@app.route("/admin/settings.html")
def admin_settings():
    if not require_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin/settings.html")
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
        source_message = str(data.get("source_message") or data.get("source") or "Lainnya").strip()

        if not message_text:
            return jsonify({"message": "Pesan wajib diisi"}), 400

        analysis = analyze_message(message_text)
        ticket_id = generate_ticket_id()

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO reports (
                        ticket_id, reporter_email, message_text, source_message,
                        extracted_urls, extracted_phones,
                        url_flag, phone_flag, nlp_prob, ai_extra_score,
                        risk_score, risk_level, admin_status, admin_note
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        ticket_id,
                        reporter_email if reporter_email else None,
                        analysis["message_text"],
                        source_message,
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

        if reporter_email:
            subject, html, text_email = build_ticket_created_email(
                ticket_id,
                analysis["risk_score"],
                analysis["risk_level"]
            )
            send_email_notification(reporter_email, subject, html, text_email)

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
                    source_message,
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

    reporter_email = None

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT reporter_email FROM reports WHERE ticket_id=%s LIMIT 1",
                (ticket_id,)
            )
            existing_report = cur.fetchone()

            if not existing_report:
                return jsonify({"message": "Ticket tidak ditemukan"}), 404

            reporter_email = existing_report.get("reporter_email")

            cur.execute(
                "UPDATE reports SET admin_status=%s, admin_note=%s WHERE ticket_id=%s",
                (admin_status, admin_note, ticket_id),
            )

    if reporter_email:
        subject, html, text_email = build_status_updated_email(
            ticket_id,
            admin_status,
            admin_note
        )
        send_email_notification(reporter_email, subject, html, text_email)

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
# ADMIN ANALYTICS API
# =========================================================

@app.route("/admin/analytics/summary", methods=["GET"])
def admin_analytics_summary():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    today = datetime.now().date()
    start_date = today - timedelta(days=6)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DATE(created_at) AS report_date, COUNT(*) AS total
                FROM reports
                WHERE DATE(created_at) >= %s
                GROUP BY DATE(created_at)
                ORDER BY DATE(created_at) ASC
            """, (start_date,))
            trend_rows = cur.fetchall()

            cur.execute("SELECT COUNT(*) AS total_reports FROM reports")
            total_reports = cur.fetchone()["total_reports"]

            cur.execute("SELECT COUNT(*) AS total FROM whitelist_domains")
            total_domains = cur.fetchone()["total"]

            cur.execute("SELECT COUNT(*) AS total FROM whitelist_phones")
            total_phones = cur.fetchone()["total"]

    trend_map = {str(row["report_date"]): row["total"] for row in trend_rows}
    trend = []

    for i in range(7):
        day = start_date + timedelta(days=i)
        trend.append({
            "date": str(day),
            "label": day.strftime("%a").upper(),
            "total": trend_map.get(str(day), 0)
        })

    return jsonify({
        "total_reports": total_reports,
        "total_domains": total_domains,
        "total_phones": total_phones,
        "trend": trend
    }), 200


@app.route("/admin/analytics/scam-types", methods=["GET"])
def admin_scam_types():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT ticket_id, message_text, extracted_urls, extracted_phones, risk_level, risk_score
                FROM reports
                ORDER BY created_at DESC
            """)
            rows = cur.fetchall()

    counters = {
        "Phishing Link": 0,
        "Social Engineering": 0,
        "Impersonasi Bank": 0,
        "Carding / APK": 0,
    }

    for row in rows:
        msg = (row.get("message_text") or "").lower()
        urls = (row.get("extracted_urls") or "").strip()

        if urls:
            counters["Phishing Link"] += 1

        if any(word in msg for word in [
            "hadiah", "bonus", "segera", "urgent", "hubungi",
            "transfer", "biaya", "daftar ulang"
        ]):
            counters["Social Engineering"] += 1

        if any(word in msg for word in [
            "bank", "rekening", "akun", "otp", "pin", "verifikasi"
        ]):
            counters["Impersonasi Bank"] += 1

        if any(word in msg for word in [
            "apk", "install", "download aplikasi", "carding"
        ]):
            counters["Carding / APK"] += 1

    total = sum(counters.values()) or 1

    result = []
    for name, count in counters.items():
        result.append({
            "name": name,
            "count": count,
            "percentage": round((count / total) * 100)
        })

    result.sort(key=lambda x: x["count"], reverse=True)
    return jsonify(result), 200

@app.route("/admin/analytics/message-sources", methods=["GET"])
def admin_message_sources():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COALESCE(NULLIF(source_message, ''), 'Lainnya') AS source_message,
                    COUNT(*) AS total
                FROM reports
                GROUP BY COALESCE(NULLIF(source_message, ''), 'Lainnya')
                ORDER BY total DESC
            """)
            rows = cur.fetchall()

    total_reports = sum(int(row["total"] or 0) for row in rows) or 1

    result = []
    for row in rows:
        source = row["source_message"] or "Lainnya"
        count = int(row["total"] or 0)

        result.append({
            "source": source,
            "count": count,
            "percentage": round((count / total_reports) * 100)
        })

    return jsonify(result), 200

# =========================================================
# ADMIN WHITELIST API
# =========================================================

@app.route("/admin/whitelist/domains", methods=["GET"])
def admin_get_domains():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, domain, created_at
                FROM whitelist_domains
                ORDER BY domain ASC
            """)
            rows = cur.fetchall()

    return jsonify(rows), 200


@app.route("/admin/whitelist/phones", methods=["GET"])
def admin_get_phones():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, phone, created_at
                FROM whitelist_phones
                ORDER BY phone ASC
            """)
            rows = cur.fetchall()

    return jsonify(rows), 200


@app.route("/admin/whitelist/domain", methods=["POST"])
def admin_add_domain():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    domain = str(data.get("domain") or "").strip().lower()

    if not domain:
        return jsonify({"message": "Domain wajib diisi"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO whitelist_domains(domain) VALUES (%s)",
                (domain,)
            )

    return jsonify({"message": "Domain berhasil ditambahkan"}), 200


@app.route("/admin/whitelist/phone", methods=["POST"])
def admin_add_phone():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    phone = normalize_phone(str(data.get("phone") or "").strip())

    if not phone:
        return jsonify({"message": "Nomor wajib diisi"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO whitelist_phones(phone) VALUES (%s)",
                (phone,)
            )

    return jsonify({"message": "Nomor berhasil ditambahkan"}), 200


@app.route("/admin/whitelist/domain/<int:item_id>", methods=["DELETE"])
def admin_delete_domain(item_id):
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM whitelist_domains WHERE id=%s", (item_id,))

    return jsonify({"message": "Domain berhasil dihapus"}), 200


@app.route("/admin/whitelist/phone/<int:item_id>", methods=["DELETE"])
def admin_delete_phone(item_id):
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM whitelist_phones WHERE id=%s", (item_id,))

    return jsonify({"message": "Nomor berhasil dihapus"}), 200
    
# =========================================================
# ADMIN EXPORT API
# =========================================================

@app.route("/admin/export/reports", methods=["GET"])
def admin_export_reports():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
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

    output = []
    header = [
        "ticket_id",
        "reporter_email",
        "message_text",
        "extracted_urls",
        "extracted_phones",
        "url_flag",
        "phone_flag",
        "nlp_prob",
        "ai_extra_score",
        "risk_score",
        "risk_level",
        "admin_status",
        "admin_note",
        "created_at",
        "updated_at",
    ]
    output.append(",".join(header))

    for row in rows:
        values = []
        for col in header:
            val = row.get(col, "")
            val = "" if val is None else str(val)
            val = val.replace('"', '""')
            values.append(f'"{val}"')
        output.append(",".join(values))

    csv_data = "\n".join(output)
    filename = f"fraudguard_reports_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

 # =========================================================
# EDUCATION API
# =========================================================

@app.route("/admin/education/articles", methods=["GET"])
def admin_get_education_articles():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, title, category, summary, content, quiz_data, status, read_time, image_url, created_at, updated_at
FROM education_articles
                ORDER BY updated_at DESC, created_at DESC
            """)
            rows = cur.fetchall()

    return jsonify(rows), 200


@app.route("/admin/education/article", methods=["POST"])
def admin_add_education_article():
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}

    title = str(data.get("title") or "").strip()
    category = str(data.get("category") or "").strip()
    summary = str(data.get("summary") or "").strip()
    content = str(data.get("content") or "").strip()
    status = str(data.get("status") or "Draft").strip()
    read_time = str(data.get("read_time") or "5 mnt baca").strip()
    image_url = str(data.get("image_url") or "").strip()
    quiz_data = data.get("quiz_data") or []

    if not title or not category or not summary or not content:
        return jsonify({"message": "Semua field wajib diisi"}), 400

    if status not in ["Draft", "Published"]:
        return jsonify({"message": "Status tidak valid"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO education_articles
                (title, category, summary, content, quiz_data, status, read_time, image_url)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                title,
                category,
                summary,
                content,
                json.dumps(quiz_data, ensure_ascii=False),
                status,
                read_time,
                image_url
            ))

    return jsonify({"message": "Materi edukasi berhasil ditambahkan"}), 200


@app.route("/admin/education/article/<int:article_id>", methods=["PUT"])
def admin_update_education_article(article_id):
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}

    title = str(data.get("title") or "").strip()
    category = str(data.get("category") or "").strip()
    summary = str(data.get("summary") or "").strip()
    content = str(data.get("content") or "").strip()
    status = str(data.get("status") or "Draft").strip()
    read_time = str(data.get("read_time") or "5 mnt baca").strip()
    image_url = str(data.get("image_url") or "").strip()
    quiz_data = data.get("quiz_data") or []

    if not title or not category or not summary or not content:
        return jsonify({"message": "Semua field wajib diisi"}), 400

    if status not in ["Draft", "Published"]:
        return jsonify({"message": "Status tidak valid"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE education_articles
                SET title=%s, category=%s, summary=%s, content=%s, quiz_data=%s, status=%s, read_time=%s, image_url=%s
                WHERE id=%s
            """, (
                title,
                category,
                summary,
                content,
                json.dumps(quiz_data, ensure_ascii=False),
                status,
                read_time,
                image_url,
                article_id
            ))

            if cur.rowcount == 0:
                return jsonify({"message": "Artikel tidak ditemukan"}), 404

    return jsonify({"message": "Artikel berhasil diperbarui"}), 200


@app.route("/admin/education/article/<int:article_id>", methods=["DELETE"])
def admin_delete_education_article(article_id):
    if not require_admin():
        return jsonify({"message": "Unauthorized"}), 401

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM education_articles WHERE id=%s", (article_id,))
            if cur.rowcount == 0:
                return jsonify({"message": "Artikel tidak ditemukan"}), 404

    return jsonify({"message": "Artikel berhasil dihapus"}), 200

@app.route("/api/education/articles", methods=["GET"])
def user_get_education_articles():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, title, category, summary, content, quiz_data, read_time, image_url, created_at
                FROM education_articles
                WHERE status='Published'
                ORDER BY updated_at DESC, created_at DESC
            """)
            rows = cur.fetchall()

    return jsonify(rows), 200

@app.route("/api/education/article/<int:article_id>", methods=["GET"])
def user_get_education_article(article_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, title, category, summary, content, quiz_data, read_time, image_url, created_at
                FROM education_articles
                WHERE id=%s AND status='Published'
                LIMIT 1
            """, (article_id,))
            row = cur.fetchone()

    if not row:
        return jsonify({"message": "Materi edukasi tidak ditemukan"}), 404

    return jsonify(row), 200
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