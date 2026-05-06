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
BCC_BATCH_SIZE = 50


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
    Send an HTML email via Zoho SMTP with explicit To/Cc/Bcc headers.

    BCC recipients are split into batches of BCC_BATCH_SIZE to stay within
    Zoho's per-message recipient limit. All batches share one SMTP connection.
    To/CC recipients are included only in the first batch to avoid duplicates.
    """
    _validate_smtp_config()

    cc_emails = cc_emails or []
    bcc_emails = bcc_emails or []

    if not to_emails and not cc_emails and not bcc_emails:
        raise EmailSendError('At least one recipient (To, Cc, or Bcc) is required.')
    if not subject.strip():
        raise EmailSendError('Email subject is required.')

    plain_body = _strip_html(html_body).strip()
    if not plain_body:
        raise EmailSendError('Email message is required.')

    subject = subject.strip()
    html_body = html_body.strip()

    bcc_batches = (
        [bcc_emails[i:i + BCC_BATCH_SIZE] for i in range(0, len(bcc_emails), BCC_BATCH_SIZE)]
        if bcc_emails else [[]]
    )

    try:
        with smtplib.SMTP(ZOHO_SMTP_HOST, ZOHO_SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
            if ZOHO_SMTP_USE_TLS:
                smtp.starttls()
            smtp.login(ZOHO_SMTP_USER, ZOHO_SMTP_APP_PASSWORD)

            for batch_index, bcc_batch in enumerate(bcc_batches):
                msg = EmailMessage()
                msg['From'] = ZOHO_SMTP_USER
                msg['Subject'] = subject

                if batch_index == 0:
                    msg['To'] = ', '.join(to_emails) if to_emails else 'undisclosed-recipients:;'
                    if cc_emails:
                        msg['Cc'] = ', '.join(cc_emails)
                else:
                    msg['To'] = 'undisclosed-recipients:;'

                if bcc_batch:
                    msg['Bcc'] = ', '.join(bcc_batch)

                msg.set_content(plain_body)
                msg.add_alternative(html_body, subtype='html')
                smtp.send_message(msg)

    except smtplib.SMTPAuthenticationError as exc:
        raise EmailConfigError('SMTP authentication failed. Check Zoho SMTP credentials.') from exc
    except smtplib.SMTPException as exc:
        raise EmailSendError(f'SMTP error while sending email: {exc}') from exc
    except OSError as exc:
        raise EmailSendError(f'Network error while sending email: {exc}') from exc


def send_html_emails_individually(
    *,
    addresses: list[str],
    subject: str,
    html_body: str,
) -> list[tuple[str, str | None]]:
    """
    Send one email per address, reusing a single SMTP connection.
    Returns [(address, None), ...] on success or [(address, error_str), ...] per failure.
    Per-recipient SMTPRecipientsRefused is recorded without aborting the rest;
    all other SMTP / network errors are fatal and raised immediately.
    """
    _validate_smtp_config()

    if not addresses:
        raise EmailSendError('At least one recipient is required.')
    if not subject.strip():
        raise EmailSendError('Email subject is required.')

    plain_body = _strip_html(html_body).strip()
    if not plain_body:
        raise EmailSendError('Email message is required.')

    subject = subject.strip()
    html_body = html_body.strip()
    outcomes: list[tuple[str, str | None]] = []

    try:
        with smtplib.SMTP(ZOHO_SMTP_HOST, ZOHO_SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
            if ZOHO_SMTP_USE_TLS:
                smtp.starttls()
            smtp.login(ZOHO_SMTP_USER, ZOHO_SMTP_APP_PASSWORD)

            for i, address in enumerate(addresses):
                msg = EmailMessage()
                msg['From'] = ZOHO_SMTP_USER
                msg['To'] = address
                msg['Subject'] = subject
                msg.set_content(plain_body)
                msg.add_alternative(html_body, subtype='html')
                try:
                    smtp.send_message(msg)
                    outcomes.append((address, None))
                except (smtplib.SMTPRecipientsRefused, smtplib.SMTPDataError) as exc:
                    # Per-recipient error — record and continue with remaining addresses.
                    outcomes.append((address, str(exc)))
                except (smtplib.SMTPException, OSError) as exc:
                    # Fatal mid-loop error (connection dropped, rate-limited, etc.).
                    # Mark this address and all remaining ones as failed so the caller
                    # gets an accurate partial picture rather than losing the outcomes
                    # already recorded above.
                    for addr in addresses[i:]:
                        outcomes.append((addr, f'Connection lost: {exc}'))
                    return outcomes

    except smtplib.SMTPAuthenticationError as exc:
        raise EmailConfigError('SMTP authentication failed. Check Zoho SMTP credentials.') from exc
    except smtplib.SMTPException as exc:
        raise EmailSendError(f'SMTP error while sending email: {exc}') from exc
    except OSError as exc:
        raise EmailSendError(f'Network error while sending email: {exc}') from exc

    return outcomes
