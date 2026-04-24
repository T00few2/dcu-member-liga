import smtplib
from email.message import EmailMessage
from html.parser import HTMLParser

from config import (
    ZOHO_SMTP_APP_PASSWORD,
    ZOHO_SMTP_HOST,
    ZOHO_SMTP_PORT,
    ZOHO_SMTP_USE_TLS,
    ZOHO_SMTP_USER,
)


SMTP_TIMEOUT_SECONDS = 20


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {'p', 'br', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}:
            self._parts.append('\n')

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return ''.join(self._parts)


def _strip_html(html: str) -> str:
    stripper = _HTMLStripper()
    stripper.feed(html)
    return stripper.get_text()


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


def send_html_email(
    *,
    to_emails: list[str],
    cc_emails: list[str] | None = None,
    bcc_emails: list[str] | None = None,
    subject: str,
    html_body: str,
) -> None:
    """
    Send one HTML email via Zoho SMTP with explicit To/Cc/Bcc headers.

    Python's smtp.send_message() collects all Bcc addresses as RCPT TO
    targets and strips the Bcc header from the transmitted message, so
    Bcc recipients are never exposed to other recipients.
    """
    _validate_smtp_config()

    cc_emails = cc_emails or []
    bcc_emails = bcc_emails or []
    all_recipients = to_emails + cc_emails + bcc_emails

    if not all_recipients:
        raise EmailSendError('At least one recipient (To, Cc, or Bcc) is required.')
    if not subject.strip():
        raise EmailSendError('Email subject is required.')

    plain_body = _strip_html(html_body).strip()
    if not plain_body:
        raise EmailSendError('Email message is required.')

    email = EmailMessage()
    email['From'] = ZOHO_SMTP_USER
    email['Subject'] = subject.strip()
    email['To'] = ', '.join(to_emails) if to_emails else 'undisclosed-recipients:;'
    if cc_emails:
        email['Cc'] = ', '.join(cc_emails)
    if bcc_emails:
        email['Bcc'] = ', '.join(bcc_emails)
    email.set_content(plain_body)
    email.add_alternative(html_body.strip(), subtype='html')

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
