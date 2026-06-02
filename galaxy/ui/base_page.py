"""Base conversion page shared by image/video/audio tabs."""
import os
from datetime import datetime

from galaxy_fonts import make_mono_qfont
from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QAction, QColor, QDesktopServices
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFileDialog,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMenu,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from galaxy.core.utils import (
    ensure_writable_dir,
    file_has_extension,
    format_size,
    parse_format_extensions,
)
from galaxy.ui.layout_direction import apply_layout_direction
from galaxy.ui.theme import _pal, build_menu_stylesheet, build_stylesheet
from galaxy.ui.widgets import (
    make_drop_zone,
    make_page_header,
    make_steps_guide,
    set_tip,
)
from galaxy.workers.image_worker import ImageWorker
from galaxy.workers.media_worker import MediaWorker


class BasePage(QWidget):
    PAGE_ID = 'image'  # override: image | video | audio
    STEP_KEYS = ('step.add', 'step.settings', 'step.convert')

    def tr(self, key, **kw):
        if self.parent_window and hasattr(self.parent_window, 'i18n'):
            return self.parent_window.i18n.t(key, **kw)
        return key

    def _theme_color(self, key, fallback="#888888"):
        theme = getattr(self.parent_window, 'settings', {}).get('theme', 'dark_cyan')
        return QColor(_pal(theme).get(key, fallback))

    def __init__(self, title, formats, parent_window):
        super().__init__()
        self.parent_window = parent_window
        self.formats = formats
        self.page_title = title
        self.worker = None
        self.file_paths = []
        self._form_rows = []
        self._footer_tier_key = ""
        self._footer_encoder = "CPU"

        self.setAcceptDrops(True)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)

        scroll = QScrollArea()
        self._scroll_area = scroll
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setStyleSheet("background: transparent;")
        content = QWidget()
        self.layout = QVBoxLayout(content)
        self.layout.setSpacing(16)
        self.layout.setContentsMargins(28, 24, 28, 16)

        header, self.lbl_page_title, self.lbl_page_sub = make_page_header("", "")
        self.layout.addWidget(header)
        self.steps_guide = make_steps_guide([], '◂')
        self.layout.addWidget(self.steps_guide)

        self.drop_zone = make_drop_zone(getattr(parent_window, 'i18n', None))
        self.drop_zone.clicked.connect(self._on_drop_zone_click)
        self.layout.addWidget(self.drop_zone)

        self.lbl_files_section = QLabel()
        self.lbl_files_section.setObjectName("SectionLabel")
        self.lbl_files_section.setVisible(False)
        self.layout.addWidget(self.lbl_files_section)

        self.table_widget = QTableWidget()
        self.table_widget.setColumnCount(4)
        self._table_headers = ['table.name', 'table.size', 'table.date', 'table.status']
        self.table_widget.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table_widget.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self.table_widget.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.table_widget.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Fixed)
        self.table_widget.setColumnWidth(3, 120)
        self.table_widget.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table_widget.setAlternatingRowColors(True)
        self.table_widget.setMinimumHeight(180)
        self.table_widget.verticalHeader().setVisible(False)
        self.table_widget.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table_widget.customContextMenuRequested.connect(self.show_context_menu)
        self.table_widget.itemDoubleClicked.connect(self.open_file_location)
        set_tip(self.table_widget, "")
        self.layout.addWidget(self.table_widget)

        file_toolbar = QFrame()
        file_toolbar.setObjectName("FileToolbar")
        h_btn = QHBoxLayout(file_toolbar)
        h_btn.setContentsMargins(10, 8, 10, 8)
        h_btn.setSpacing(8)
        self.btn_add = QPushButton()
        self.btn_add.setObjectName("SecondaryBtn")
        self.btn_add.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_add.clicked.connect(lambda: self.add_files(formats))
        self.btn_folder = QPushButton()
        self.btn_folder.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_folder.clicked.connect(lambda: self.add_folder(formats))
        self.btn_reset = QPushButton()
        self.btn_reset.setObjectName("GhostBtn")
        self.btn_reset.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_reset.clicked.connect(self.clear_list)
        self.btn_clear = QPushButton()
        self.btn_clear.setObjectName("GhostBtn")
        self.btn_clear.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_clear.clicked.connect(self.remove_selected)
        h_btn.addWidget(self.btn_add, 2)
        h_btn.addWidget(self.btn_folder, 1)
        h_btn.addWidget(self.btn_reset)
        h_btn.addWidget(self.btn_clear)
        self.layout.addWidget(file_toolbar)

        self.settings_group = QGroupBox()
        self.sets_layout = QVBoxLayout(self.settings_group)
        self.layout.addWidget(self.settings_group)
        self.layout.addStretch()

        scroll.setWidget(content)
        main_layout.addWidget(scroll, 1)

        self.action_bar = QFrame()
        self.action_bar.setObjectName("ConversionActionBar")
        action_lay = QVBoxLayout(self.action_bar)
        action_lay.setContentsMargins(0, 0, 0, 0)
        action_lay.setSpacing(8)

        self.lbl_local_status = QLabel()
        self.lbl_local_status.setObjectName("ActionBarStatus")
        self.lbl_local_status.setWordWrap(True)
        self.progress_bar = QProgressBar()
        self.progress_bar.setTextVisible(True)
        self.progress_bar.setFormat("  %p%  ")
        self.progress_bar.setFixedHeight(26)

        self.btn_run = QPushButton()
        self.btn_run.setObjectName("PrimaryBtn")
        self.btn_run.setMinimumHeight(52)
        self.btn_run.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_run.clicked.connect(self.start_process)

        self.btn_stop = QPushButton()
        self.btn_stop.setObjectName("DangerBtn")
        self.btn_stop.setMinimumHeight(52)
        self.btn_stop.setVisible(False)
        self.btn_stop.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_stop.clicked.connect(self.stop_process)

        h_run = QHBoxLayout()
        h_run.setSpacing(10)
        h_run.addWidget(self.btn_run, 1)
        h_run.addWidget(self.btn_stop, 1)

        action_lay.addWidget(self.lbl_local_status)
        self.lbl_pipeline = QLabel()
        self.lbl_pipeline.setObjectName("HintLabel")
        self.lbl_pipeline.setWordWrap(True)
        action_lay.addWidget(self.lbl_pipeline)
        action_lay.addWidget(self.progress_bar)
        action_lay.addLayout(h_run)
        main_layout.addWidget(self.action_bar)

        self._refresh_stats()
        self._sync_action_buttons()

    def _on_drop_zone_click(self):
        if self.worker and self.worker.isRunning():
            return
        self.add_files(self.formats)

    def _advanced_enabled(self):
        grp = getattr(self, 'advanced_group', None)
        if grp is None or not grp.isVisible():
            return False
        if not grp.isCheckable():
            return True
        return grp.isChecked()

    def _sync_action_buttons(self):
        running = bool(self.worker and self.worker.isRunning())
        has_files = bool(self.file_paths)
        if running:
            self.btn_run.setVisible(False)
            self.btn_stop.setVisible(True)
            self.btn_stop.setEnabled(True)
        else:
            self.btn_run.setVisible(True)
            self.btn_stop.setVisible(False)
            self.btn_run.setEnabled(has_files)
            if has_files:
                set_tip(self.btn_run, self.tr('btn.start_tip'))
            else:
                set_tip(self.btn_run, self.tr('btn.start_disabled_tip'))

    def retranslate_ui(self):
        pid = getattr(self, 'PAGE_ID', 'image')
        self.lbl_page_title.setText(self.tr(f'page.{pid}.title'))
        self.lbl_page_sub.setText(self.tr(f'page.{pid}.sub'))
        steps = [self.tr(k) for k in self.STEP_KEYS]
        arrow = '◂' if (self.parent_window and self.parent_window.i18n.is_rtl()) else '▸'
        old = self.steps_guide
        idx = self.layout.indexOf(old)
        self.steps_guide = make_steps_guide(steps, arrow)
        self.layout.insertWidget(idx, self.steps_guide)
        old.deleteLater()
        self.table_widget.setHorizontalHeaderLabels([self.tr(k) for k in self._table_headers])
        set_tip(self.table_widget, self.tr('table.tip'))
        self.btn_add.setText(self.tr('btn.select_files'))
        self.btn_folder.setText(self.tr('btn.select_folder'))
        self.btn_reset.setText(self.tr('btn.clear_all'))
        self.btn_clear.setText(self.tr('btn.remove_sel'))
        set_tip(self.btn_add, self.tr('btn.select_files_tip'))
        set_tip(self.btn_folder, self.tr('btn.select_folder_tip'))
        set_tip(self.btn_reset, self.tr('btn.clear_all_tip'))
        set_tip(self.btn_clear, self.tr('btn.remove_sel_tip'))
        self.settings_group.setTitle(self.tr('settings.output_group'))
        set_tip(self.settings_group, self.tr('settings.output_group_tip'))
        if self.worker and self.worker.isRunning():
            self.lbl_local_status.setText(self.tr('status.converting'))
        elif self.file_paths:
            self.lbl_local_status.setText(self.tr('status.list_count', n=len(self.file_paths)))
        else:
            self.lbl_local_status.setText(self.tr('status.ready'))
        set_tip(self.lbl_local_status, self.tr('status.ready_tip'))
        set_tip(self.progress_bar, self.tr('progress.tip'))
        self.btn_run.setText(self.tr('btn.start'))
        self.btn_stop.setText(self.tr('btn.stop'))
        set_tip(self.btn_stop, self.tr('btn.stop_tip'))
        self.lbl_files_section.setText(self.tr('section.files'))
        set_tip(self.lbl_files_section, self.tr('section.files_tip'))
        self.drop_zone.retranslate(getattr(self.parent_window, 'i18n', None))
        if hasattr(self, 'retranslate_page'):
            self.retranslate_page()
        self._sync_action_buttons()

    def apply_ui_preferences(self, settings):
        if hasattr(self, 'steps_guide'):
            self.steps_guide.setVisible(settings.get('show_steps', True))
        is_pro = settings.get('ui_mode') == 'professional'
        if hasattr(self, 'advanced_group'):
            self.advanced_group.setVisible(is_pro)
            if is_pro:
                self.advanced_group.setCheckable(False)
                self.advanced_group.setChecked(True)
            else:
                self.advanced_group.setCheckable(True)
                self.advanced_group.setChecked(False)
        if hasattr(self, '_hint_main'):
            self._hint_main.setVisible(is_pro)
        rtl = settings.get('language', 'fa') == 'fa'
        apply_layout_direction(self, rtl)
        if hasattr(self, 'update_pipeline_hint'):
            self.update_pipeline_hint()

    def _refresh_stats(self):
        has_files = len(self.file_paths) > 0
        self.drop_zone.setVisible(not has_files)
        self.table_widget.setVisible(has_files)
        self.lbl_files_section.setVisible(has_files)
        if has_files:
            self.lbl_local_status.setText(self.tr('status.list_count', n=len(self.file_paths)))
        elif not (self.worker and self.worker.isRunning()):
            self.lbl_local_status.setText(self.tr('status.ready'))
        self._sync_action_buttons()

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            self.drop_zone.set_drag_over(True)
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragLeaveEvent(self, event):
        self.drop_zone.set_drag_over(False)
        super().dragLeaveEvent(event)

    def dropEvent(self, event):
        self.drop_zone.set_drag_over(False)
        files = [u.toLocalFile() for u in event.mimeData().urls()]
        valid_exts = parse_format_extensions(self.formats)
        valid_files = [f for f in files if os.path.isfile(f) and file_has_extension(f, valid_exts)]
        if valid_files:
            self.process_new_files(valid_files)
            event.acceptProposedAction()
        else:
            self.lbl_local_status.setText(self.tr('status.no_drop'))
            event.ignore()

    def add_files(self, formats):
        files, _ = QFileDialog.getOpenFileNames(self, self.tr('dlg.select_files'), "", f"Files ({formats})")
        if files:
            self.process_new_files(files)

    def add_folder(self, formats):
        folder = QFileDialog.getExistingDirectory(self, self.tr('dlg.select_folder'))
        if folder:
            valid_exts = parse_format_extensions(formats)
            found = []
            for root, _, files in os.walk(folder):
                for f in files:
                    full_path = os.path.join(root, f)
                    if file_has_extension(full_path, valid_exts):
                        found.append(full_path)
            if found:
                self.process_new_files(found)
            else:
                self.lbl_local_status.setText(self.tr('status.no_folder'))

    def process_new_files(self, files):
        added = 0
        for f in files:
            if f not in self.file_paths:
                row = self.table_widget.rowCount()
                self.table_widget.insertRow(row)
                name_item = QTableWidgetItem(os.path.basename(f))
                name_item.setToolTip(f)
                self.table_widget.setItem(row, 0, name_item)
                try: size_str = format_size(os.path.getsize(f))
                except OSError: size_str = "Unknown"
                size_item = QTableWidgetItem(size_str)
                fk = getattr(self.parent_window, 'settings', {}).get('font_size', 'medium')
                size_item.setFont(make_mono_qfont(fk))
                self.table_widget.setItem(row, 1, size_item)
                try:
                    mtime = os.path.getmtime(f)
                    date_str = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d')
                except OSError: date_str = "-"
                self.table_widget.setItem(row, 2, QTableWidgetItem(date_str))

                status_item = QTableWidgetItem(self.tr('table.pending'))
                status_item.setForeground(self._theme_color('text_muted'))
                self.table_widget.setItem(row, 3, status_item)

                self.file_paths.append(f)
                added += 1
        if added:
            self.lbl_local_status.setText(self.tr('status.added', added=added, total=len(self.file_paths)))
        self._refresh_stats()

    def show_context_menu(self, pos):
        theme = getattr(self.parent_window, 'settings', {}).get('theme', 'dark_cyan')
        menu = QMenu()
        menu.setStyleSheet(build_menu_stylesheet(theme))
        open_action = QAction(self.tr('menu.open_folder'), self)
        open_action.triggered.connect(self.open_file_location)
        menu.addAction(open_action)
        remove_action = QAction(self.tr('menu.remove'), self)
        remove_action.triggered.connect(self.remove_selected)
        menu.addAction(remove_action)
        menu.exec(self.table_widget.mapToGlobal(pos))

    def remove_selected(self):
        rows = sorted(set(index.row() for index in self.table_widget.selectedIndexes()), reverse=True)
        for row in rows:
            self.file_paths.pop(row)
            self.table_widget.removeRow(row)
        self._refresh_stats()

    def clear_list(self):
        self.table_widget.setRowCount(0)
        self.file_paths = []
        self.progress_bar.setValue(0)
        self.lbl_local_status.setText(self.tr('status.cleared'))
        self._refresh_stats()

    def open_file_location(self):
        row = self.table_widget.currentRow()
        if row >= 0 and row < len(self.file_paths):
            QDesktopServices.openUrl(QUrl.fromLocalFile(os.path.dirname(self.file_paths[row])))

    def update_pipeline_hint(self):
        if hasattr(self, '_sync_pipeline_hint'):
            self._sync_pipeline_hint()
        else:
            self.lbl_pipeline.setVisible(False)

    def _on_pipeline_update(self, tier_key: str):
        mapping = {
            'copy': 'pipeline.copy',
            'cpu': 'pipeline.cpu',
        }
        if tier_key.startswith('full_gpu'):
            key = 'pipeline.full_gpu'
        elif tier_key.startswith('encode_gpu'):
            key = 'pipeline.encode_only'
        else:
            key = mapping.get(tier_key, 'pipeline.cpu')
        text = self.tr(key)
        self.lbl_pipeline.setText(text)
        self.lbl_pipeline.setVisible(True)
        if self.parent_window and hasattr(self.parent_window, 'set_conversion_badge'):
            self._footer_tier_key = tier_key
            self.parent_window.set_conversion_badge(
                active=True,
                encoder_label=self._footer_encoder,
                done=getattr(self, '_batch_done', 0),
                total=len(self.file_paths),
                tier_key=tier_key,
            )

    def _on_batch_progress(self, done: int, total: int):
        self._batch_done = done
        if self.parent_window and hasattr(self.parent_window, 'set_conversion_badge'):
            self.parent_window.set_conversion_badge(
                active=True,
                encoder_label=self._footer_encoder,
                done=done,
                total=total,
                tier_key=self._footer_tier_key or 'cpu',
            )

    def get_settings(self): return {}

    def _disconnect_worker(self):
        if not self.worker:
            return
        for signal, slot in (
            (self.worker.progress_signal, self.progress_bar.setValue),
            (self.worker.log_signal, self.update_local_log),
            (self.worker.file_status_signal, self.update_file_status),
            (self.worker.file_status_signal, self._track_file_result),
            (self.worker.finished_all, self.on_finished),
        ):
            try:
                signal.disconnect(slot)
            except (RuntimeError, TypeError):
                pass

    def start_process(self):
        if self.worker and self.worker.isRunning():
            return
        if not self.file_paths:
            self.show_msg(self.tr('dlg.no_files'), self.tr('dlg.no_files_msg'), QMessageBox.Icon.Information)
            return

        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.worker.wait(5000)

        try:
            ensure_writable_dir(self.parent_window.output_dir)
        except OSError as e:
            self.show_msg(self.tr('dlg.output_err'), str(e), QMessageBox.Icon.Critical)
            return

        settings = self.get_settings()
        out_dir = self.parent_window.output_dir
        self.progress_bar.setValue(0)
        self._success_count = 0
        self._fail_count = 0

        for i in range(self.table_widget.rowCount()):
            item = QTableWidgetItem(self.tr('table.working'))
            item.setForeground(self._theme_color('warning'))
            self.table_widget.setItem(i, 3, item)

        tasks_copy = list(self.file_paths)
        self._disconnect_worker()

        if self.PAGE_ID == 'image':
            self.worker = ImageWorker(tasks_copy, out_dir, settings, self.parent_window.settings)
        else:
            mode = 'audio' if self.PAGE_ID == 'audio' else 'video'
            self.worker = MediaWorker(tasks_copy, out_dir, settings, mode, self.parent_window.settings)

        self._batch_done = 0
        self._footer_tier_key = ""
        if self.PAGE_ID == 'video':
            preset = self.parent_window.settings.get('nvenc_preset', 'p4')
            self._footer_encoder = f"NVENC {preset}"
        elif self.PAGE_ID == 'image':
            self._footer_encoder = self.tr('footer.enc_pil')
        else:
            self._footer_encoder = self.tr('footer.enc_cpu')

        self.worker.progress_signal.connect(self.progress_bar.setValue)
        self.worker.log_signal.connect(self.update_local_log)
        self.worker.file_status_signal.connect(self.update_file_status)
        self.worker.file_status_signal.connect(self._track_file_result)
        self.worker.finished_all.connect(self.on_finished)
        if hasattr(self.worker, 'pipeline_signal'):
            self.worker.pipeline_signal.connect(self._on_pipeline_update)
        if hasattr(self.worker, 'batch_progress_signal'):
            self.worker.batch_progress_signal.connect(self._on_batch_progress)

        if self.parent_window and hasattr(self.parent_window, 'set_conversion_badge'):
            self.parent_window.set_conversion_badge(
                active=True,
                encoder_label=self._footer_encoder,
                done=0,
                total=len(tasks_copy),
                tier_key='cpu',
            )

        self.toggle_inputs(False)
        self._sync_action_buttons()
        self.lbl_local_status.setText(self.tr('status.converting'))
        self.worker.start()

    def stop_process(self):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            if not self.worker.wait(5000):
                self.lbl_local_status.setText(self.tr('status.stop_wait'))
                return
            self.lbl_local_status.setText(self.tr('status.stopped'))
        self.toggle_inputs(True)
        self._sync_action_buttons()

    def toggle_inputs(self, enable):
        self.btn_add.setEnabled(enable)
        self.btn_folder.setEnabled(enable)
        self.btn_clear.setEnabled(enable)
        self.btn_reset.setEnabled(enable)
        self.setAcceptDrops(enable)
        self.drop_zone.set_interactive(enable)
        self.settings_group.setEnabled(enable)
        if hasattr(self, 'advanced_group'):
            self.advanced_group.setEnabled(enable)
        self._sync_action_buttons()

    def update_local_log(self, msg): self.lbl_local_status.setText(msg)

    def _track_file_result(self, path, status):
        if status == "success":
            self._success_count += 1
        else:
            self._fail_count += 1

    def update_file_status(self, path, status):
        try:
            row = self.file_paths.index(path)
            theme = getattr(self.parent_window, 'settings', {}).get('theme', 'dark_cyan')
            p = _pal(theme)
            item = QTableWidgetItem()
            if status == "success":
                item.setText(self.tr('table.success'))
                item.setForeground(QColor(p['success']))
            else:
                item.setText(self.tr('table.fail'))
                item.setForeground(QColor(p['danger']))
            self.table_widget.setItem(row, 3, item)
        except ValueError:
            pass

    def on_finished(self):
        self.toggle_inputs(True)
        self._sync_action_buttons()
        if self.parent_window and hasattr(self.parent_window, 'set_conversion_badge'):
            self.parent_window.set_conversion_badge(active=False)
        if hasattr(self, 'update_pipeline_hint'):
            self.update_pipeline_hint()
        success = getattr(self, '_success_count', 0)
        failed = getattr(self, '_fail_count', 0)
        if failed == 0 and success > 0:
            self.lbl_local_status.setText(self.tr('status.all_ok'))
            summary = self.tr('dlg.summary_all_ok', n=success)
            icon = QMessageBox.Icon.Information
        elif success == 0 and failed > 0:
            self.lbl_local_status.setText(self.tr('status.all_fail'))
            summary = self.tr('dlg.summary_all_fail', n=failed)
            icon = QMessageBox.Icon.Warning
        elif success == 0 and failed == 0:
            self.lbl_local_status.setText(self.tr('status.no_work'))
            summary = self.tr('dlg.summary_no_work')
            icon = QMessageBox.Icon.Warning
        else:
            self.lbl_local_status.setText(self.tr('status.mixed', ok=success, fail=failed))
            summary = self.tr('dlg.summary_mixed', ok=success, fail=failed)
            icon = QMessageBox.Icon.Warning
        msg = QMessageBox(self)
        msg.setWindowTitle(self.tr('dlg.done_title'))
        msg.setText(summary)
        msg.setIcon(icon)
        msg.setStandardButtons(QMessageBox.StandardButton.Ok)
        open_btn = None
        if success > 0:
            open_btn = msg.addButton(self.tr('dlg.open_output'), QMessageBox.ButtonRole.AcceptRole)
        theme = getattr(self.parent_window, 'settings', {}).get('theme', 'dark_cyan')
        font_key = getattr(self.parent_window, 'settings', {}).get('font_size', 'medium')
        lang = getattr(self.parent_window, 'settings', {}).get('language', 'fa')
        msg.setStyleSheet(build_stylesheet(theme, font_key, lang))
        msg.exec()
        if open_btn and msg.clickedButton() == open_btn:
            QDesktopServices.openUrl(QUrl.fromLocalFile(self.parent_window.output_dir))

    def show_msg(self, title, text, icon):
        msg = QMessageBox(self)
        msg.setWindowTitle(title)
        msg.setText(text)
        msg.setIcon(icon)
        theme = getattr(self.parent_window, 'settings', {}).get('theme', 'dark_cyan')
        font_key = getattr(self.parent_window, 'settings', {}).get('font_size', 'medium')
        lang = getattr(self.parent_window, 'settings', {}).get('language', 'fa')
        msg.setStyleSheet(build_stylesheet(theme, font_key, lang))
        msg.exec()

