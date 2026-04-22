import smtplib
from email.message import EmailMessage

from config import (
    ZOHO_SMTP_APP_PASSWORD,
    ZOHO_SMTP_HOST,
    ZOHO_SMTP_PORT,
    ZOHO_SMTP_USE_TLS,
    ZOHO_SMTP_USER,
)


SMTP_TIMEOUT_SECONDS = 20


class EmailConfigError(Exception):
    pass


class EmailSendError(Exception):
    pass


def _validate_smtp_config() -> None:
    if not ZOHO_SMTP_USER or not ZOHO_SMTP_APP_PASSWORD:
        raise EmailConfigError(
            'Email service is not configured. Missing ZOHO_SMTP_USER or ZOHO_SMTP_APP_PASSWORD.'
        )
    if not ZOHO_SMTP_HOST:
        raise EmailConfigError('Email service is not configured. Missing ZOHO_SMTP_HOST.')
    if not isinstance(ZOHO_SMTP_PORT, int) or ZOHO_SMTP_PORT <= 0:
        raise EmailConfigError('Email service is not configured. Invalid ZOHO_SMTP_PORT.')


def send_plain_email(*, to_email: str, subject: str, message: str) -> None:
    """
    Send a single plain-text email via Zoho SMTP.
    """
    _validate_smtp_config()

    if not to_email:
        raise EmailSendError('Recipient email is required.')
    if not subject.strip():
        raise EmailSendError('Email subject is required.')
    if not message.strip():
        raise EmailSendError('Email message is required.')

    email = EmailMessage()
    email['From'] = ZOHO_SMTP_USER
    email['To'] = to_email
    email['Subject'] = subject.strip()
    email.set_content(message.strip())

    try:
        with smtplib.SMTP(ZOHO_SMTP_HOST, ZOHO_SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
            if ZOHO_SMTP_USE_TLS:
                smtp.starttls()
            smtp.login(ZOHO_SMTP_USER, ZOHO_SMTP_APP_PASSWORD)
            smtp.send_message(email)
    except smtplib.SMTPAuthenticationError as exc:
        raise EmailConfigError('SMTP authentication failed. Check Zoho SMTP credentials.') from exc
    except smtplib.SMTPException as exc:
        raise EmailSendError(f'SMTP error while sending email: {exc}') from exc
    except OSError as exc:
        raise EmailSendError(f'Network error while sending email: {exc}') from exc
