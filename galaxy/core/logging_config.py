"""Central logging configuration."""
import logging
import os


def setup_logging():
    log_dir = os.path.join(os.path.expanduser("~"), ".galaxy_converter")
    try:
        os.makedirs(log_dir, exist_ok=True)
    except OSError:
        pass

    log_file = os.path.join(log_dir, "galaxy_converter.log")
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            handlers=[
                logging.FileHandler(log_file, encoding="utf-8"),
                logging.StreamHandler(),
            ],
        )
    logging.info("Galaxy Media Pro started on PySide6")
