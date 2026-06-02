"""Application constants."""
APP_VERSION = "3.0 Pro"
APP_NAME = "Galaxy Media Pro"
AUTHOR_NAME = "Ali Rashidi"
AUTHOR_TELEGRAM_CHANNEL = "writeyourway"
AUTHOR_TELEGRAM_ID = "a_ra_80"
ORG_NAME = "Write Your Way"
# اضافه شدن ساپورت واقعی HEIC
HEIF_SUPPORTED = False
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:
    pass

AUDIO_CONTAINER_EXT = {
    'alac': 'm4a',
    'aac': 'aac',
    'm4a': 'm4a',
}
