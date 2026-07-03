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

from galaxy.core.exceptions import OutputDirError
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
from galaxy.workers.task_queue import ConversionTaskQueue


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
        self._user_stopped = False
        self._stop_pending = False
        self._conversion_running = False
        self._starting_conversion = False
        self._task_queue = None
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
        self.btn_stop.setMinimumWidth(140)
        self.btn_stop.setVisible(True)
        self.btn_stop.setEnabled(False)
        self.btn_stop.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_stop.clicked.connect(self.stop_process)

        h_run = QHBoxLayout()
        h_run.setSpacing(10)
        h_run.addWidget(self.btn_run, 2)
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
        self.add_files(self.formats)

    def _is_converting(self) -> bool:
        """UI-owned conversion flag only (do not use QThread.isRunning() here).

        worker.isRunning() can stay True briefly after finished_all is queued, which
        left Start stuck on «converting» and kept settings disabled after finish/stop.
        """
        return self._conversion_running

    def _is_start_locked(self) -> bool:
        """Block duplicate start clicks while preparing or running."""
        return self._conversion_running or self._starting_conversion

    def is_busy(self) -> bool:
        """True while this page is starting or converting (for main window guards)."""
        return self._is_start_locked()

    def _sibling_pages_busy(self) -> bool:
        """True if another tab is starting or converting (shared footer badge)."""
        win = self.parent_window
        if not win or not hasattr(win, 'stack'):
            return False
        for i in range(win.stack.count()):
            page = win.stack.widget(i)
            if page is self:
                continue
            if isinstance(page, BasePage) and page.is_busy():
                return True
        return False

    def _clear_footer_badge_if_idle(self) -> None:
        if self.parent_window and hasattr(self.parent_window, 'set_conversion_badge'):
            if not self.is_busy() and not self._sibling_pages_busy():
                self.parent_window.set_conversion_badge(active=False)

    def _sync_file_paths_into_task_queue(self) -> list[str]:
        """Ensure every non-success file in the table is enqueued (covers adds during start prep)."""
        if self._task_queue is None:
            return []
        to_add = [
            path for i, path in enumerate(self.file_paths)
            if self._row_status_key(i) != "success"
        ]
        return self._task_queue.append(to_add) if to_add else []

    def _all_rows_success(self) -> bool:
        return bool(self.file_paths) and all(
            self._row_status_key(i) == "success" for i in range(len(self.file_paths))
        )

    def _collect_run_paths(self) -> tuple[list[str], bool]:
        """Paths for the next batch.

        Non-success rows run as usual. When every row is already success, Start means
        re-convert the full list with current settings (format/quality changes, etc.).
        """
        if not self.file_paths:
            return [], False
        needs_work: list[str] = []
        for i, path in enumerate(self.file_paths):
            if self._row_status_key(i) != "success":
                needs_work.append(path)
        if needs_work:
            return needs_work, False
        return list(self.file_paths), True

    def _row_status_key(self, row: int) -> str:
        item = self.table_widget.item(row, 3)
        if not item:
            return "pending"
        key = item.data(Qt.ItemDataRole.UserRole)
        return key if isinstance(key, str) else "pending"

    def _set_row_status(self, row: int, key: str) -> None:
        labels = {
            "pending": ("table.pending", "text_muted"),
            "queued": ("table.queued", "text_muted"),
            "working": ("table.working", "warning"),
            "success": ("table.success", "success"),
            "fail": ("table.fail", "danger"),
            "cancelled": ("table.cancelled", "text_muted"),
        }
        label_key, color_key = labels.get(key, labels["pending"])
        item = QTableWidgetItem(self.tr(label_key))
        item.setData(Qt.ItemDataRole.UserRole, key)
        item.setForeground(self._theme_color(color_key))
        self.table_widget.setItem(row, 3, item)

    def _mark_file_working(self, path: str) -> None:
        if not self._is_converting():
            return
        try:
            row = self.file_paths.index(path)
            self._set_row_status(row, "working")
        except ValueError:
            pass

    def _advanced_enabled(self):
        grp = getattr(self, 'advanced_group', None)
        if grp is None or not grp.isVisible():
            return False
        if not grp.isCheckable():
            return True
        return grp.isChecked()

    def _sync_action_buttons(self):
        running = self._is_converting()
        starting = self._starting_conversion
        has_files = bool(self.file_paths)
        self.btn_run.setVisible(True)
        self.btn_stop.setVisible(True)
        if running:
            self.btn_run.setEnabled(False)
            self.btn_run.setText(self.tr('status.converting'))
            set_tip(self.btn_run, self.tr('status.converting'))
            self.btn_stop.setEnabled(not self._stop_pending)
            set_tip(self.btn_stop, self.tr('btn.stop_tip'))
        elif starting:
            self.btn_run.setEnabled(False)
            self.btn_run.setText(self.tr('btn.start'))
            set_tip(self.btn_run, self.tr('btn.start_tip') if has_files else self.tr('btn.start_disabled_tip'))
            self.btn_stop.setEnabled(False)
            set_tip(self.btn_stop, self.tr('btn.stop_tip'))
        else:
            self.btn_run.setEnabled(has_files)
            self.btn_run.setText(self.tr('btn.start'))
            self.btn_stop.setEnabled(False)
            if has_files:
                tip_key = 'btn.start_rerun_tip' if self._all_rows_success() else 'btn.start_tip'
                set_tip(self.btn_run, self.tr(tip_key))
            else:
                set_tip(self.btn_run, self.tr('btn.start_disabled_tip'))
            set_tip(self.btn_stop, self.tr('btn.stop_tip'))

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
        if self._is_converting():
            self.lbl_local_status.setText(self.tr('status.converting'))
        elif self._starting_conversion:
            pass
        elif self.file_paths:
            self.lbl_local_status.setText(self.tr('status.list_count', n=len(self.file_paths)))
        else:
            self.lbl_local_status.setText(self.tr('status.ready'))
        set_tip(self.lbl_local_status, self.tr('status.ready_tip'))
        set_tip(self.progress_bar, self.tr('progress.tip'))
        if not self._is_converting():
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
        self._sync_action_buttons()

    def _refresh_stats(self):
        has_files = len(self.file_paths) > 0
        self.drop_zone.setVisible(not has_files)
        self.table_widget.setVisible(has_files)
        self.lbl_files_section.setVisible(has_files)
        if has_files and not self.is_busy():
            self.lbl_local_status.setText(self.tr('status.list_count', n=len(self.file_paths)))
        elif not has_files and not self.is_busy():
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
        added_paths: list[str] = []
        batch_active = self.is_busy()
        for f in files:
            if f not in self.file_paths:
                row = self.table_widget.rowCount()
                self.table_widget.insertRow(row)
                name_item = QTableWidgetItem(os.path.basename(f))
                name_item.setToolTip(f)
                self.table_widget.setItem(row, 0, name_item)
                try:
                    size_str = format_size(os.path.getsize(f))
                except OSError:
                    size_str = "Unknown"
                size_item = QTableWidgetItem(size_str)
                fk = getattr(self.parent_window, 'settings', {}).get('font_size', 'medium')
                size_item.setFont(make_mono_qfont(fk))
                self.table_widget.setItem(row, 1, size_item)
                try:
                    mtime = os.path.getmtime(f)
                    date_str = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d')
                except OSError:
                    date_str = "-"
                self.table_widget.setItem(row, 2, QTableWidgetItem(date_str))

                status_key = "queued" if batch_active else "pending"
                self._set_row_status(row, status_key)

                self.file_paths.append(f)
                added_paths.append(f)
        if added_paths:
            if batch_active and self._task_queue is not None:
                self._task_queue.append(added_paths)
                self.lbl_local_status.setText(self.tr('status.added_running', added=len(added_paths), total=len(self.file_paths)))
            elif batch_active:
                self.lbl_local_status.setText(self.tr('status.added_running', added=len(added_paths), total=len(self.file_paths)))
            else:
                self.lbl_local_status.setText(self.tr('status.added', added=len(added_paths), total=len(self.file_paths)))
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
        blocked = 0
        for row in rows:
            status = self._row_status_key(row)
            if self.is_busy():
                if status not in ("success", "fail", "cancelled"):
                    blocked += 1
                    continue
            elif status == "working":
                blocked += 1
                continue
            path = self.file_paths[row]
            if self.is_busy() and self._task_queue is not None:
                self._task_queue.discard_pending(path)
            self.file_paths.pop(row)
            self.table_widget.removeRow(row)
        if blocked:
            self.lbl_local_status.setText(self.tr('status.cannot_remove_working', n=blocked))
        self._refresh_stats()

    def clear_list(self):
        if self.is_busy():
            self.lbl_local_status.setText(self.tr('status.cannot_clear_running'))
            return
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
        if not self._is_converting():
            return
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
        if not self._is_converting():
            return
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
        for attr, slot in (
            ('progress_signal', self._on_worker_progress),
            ('log_signal', self.update_local_log),
            ('file_status_signal', self.update_file_status),
            ('file_started_signal', self._mark_file_working),
            ('finished_all', self.on_finished),
            ('finished', self._on_worker_thread_exited),
            ('pipeline_signal', self._on_pipeline_update),
            ('batch_progress_signal', self._on_batch_progress),
        ):
            signal = getattr(self.worker, attr, None)
            if signal is None:
                continue
            try:
                signal.disconnect(slot)
            except (RuntimeError, TypeError):
                pass
        try:
            self.worker.file_status_signal.disconnect(self._track_file_result)
        except (RuntimeError, TypeError, AttributeError):
            pass

    def _on_worker_thread_exited(self):
        """Run full finish if the thread ends before the finished_all slot (Qt event order)."""
        if self._conversion_running:
            self.on_finished()

    def start_process(self):
        if self._is_start_locked():
            return
        self._starting_conversion = True
        self._sync_action_buttons()
        try:
            if not self.file_paths:
                self.show_msg(self.tr('dlg.no_files'), self.tr('dlg.no_files_msg'), QMessageBox.Icon.Information)
                return

            if self.worker and self.worker.isRunning():
                self.worker.stop()
                self.worker.wait(5000)
                if self.worker.isRunning():
                    self.show_msg(
                        self.tr('dlg.output_err'),
                        self.tr('status.prev_worker_busy'),
                        QMessageBox.Icon.Warning,
                    )
                    return

            try:
                ensure_writable_dir(self.parent_window.output_dir)
            except OutputDirError as e:
                self.show_msg(self.tr('dlg.output_err'), self.tr(e.code, path=e.path), QMessageBox.Icon.Critical)
                return
            except OSError as e:
                self.show_msg(self.tr('dlg.output_err'), str(e), QMessageBox.Icon.Critical)
                return

            settings = self.get_settings()
            out_dir = self.parent_window.output_dir
            self.progress_bar.setValue(0)
            self._success_count = 0
            self._fail_count = 0
            self._user_stopped = False
            self._stop_pending = False

            run_paths, is_rerun_all = self._collect_run_paths()
            if not run_paths:
                self.show_msg(self.tr('dlg.no_files'), self.tr('dlg.no_work_left'), QMessageBox.Icon.Information)
                return

            self._disconnect_worker()
            self._task_queue = ConversionTaskQueue(run_paths)
            self._sync_file_paths_into_task_queue()

            if self.PAGE_ID == 'image':
                self.worker = ImageWorker(self._task_queue, out_dir, settings, self.parent_window.settings)
            else:
                mode = 'audio' if self.PAGE_ID == 'audio' else 'video'
                self.worker = MediaWorker(self._task_queue, out_dir, settings, mode, self.parent_window.settings)

            self._batch_done = 0
            self._footer_tier_key = ""
            if self.PAGE_ID == 'video':
                preset = self.parent_window.settings.get('nvenc_preset', 'p4')
                self._footer_encoder = f"NVENC {preset}"
            elif self.PAGE_ID == 'image':
                self._footer_encoder = self.tr('footer.enc_pil')
            else:
                self._footer_encoder = self.tr('footer.enc_cpu')

            _queued = Qt.ConnectionType.QueuedConnection
            self.worker.progress_signal.connect(self._on_worker_progress, _queued)
            self.worker.log_signal.connect(self.update_local_log, _queued)
            self.worker.file_status_signal.connect(self.update_file_status, _queued)
            self.worker.file_status_signal.connect(self._track_file_result, _queued)
            self.worker.file_started_signal.connect(self._mark_file_working, _queued)
            self.worker.finished_all.connect(self.on_finished, _queued)
            self.worker.finished.connect(self._on_worker_thread_exited, _queued)
            if hasattr(self.worker, 'pipeline_signal'):
                self.worker.pipeline_signal.connect(self._on_pipeline_update, _queued)
            if hasattr(self.worker, 'batch_progress_signal'):
                self.worker.batch_progress_signal.connect(self._on_batch_progress, _queued)

            if self.parent_window and hasattr(self.parent_window, 'set_conversion_badge'):
                self.parent_window.set_conversion_badge(
                    active=True,
                    encoder_label=self._footer_encoder,
                    done=0,
                    total=len(run_paths),
                    tier_key='cpu',
                )

            for i, path in enumerate(self.file_paths):
                if path in run_paths:
                    self._set_row_status(i, "working")

            self._conversion_running = True
            try:
                self._sync_file_paths_into_task_queue()
                self.toggle_inputs(False)
                self._sync_action_buttons()
                if is_rerun_all:
                    self.lbl_local_status.setText(self.tr('status.rerun_all', n=len(run_paths)))
                else:
                    self.lbl_local_status.setText(self.tr('status.converting'))
                self.worker.start()
                self._sync_action_buttons()
            except Exception:
                self._conversion_running = False
                self._stop_pending = False
                self._disconnect_worker()
                self.worker = None
                self._task_queue = None
                self.toggle_inputs(True)
                self._sync_action_buttons()
                self._clear_footer_badge_if_idle()
                raise
        finally:
            self._starting_conversion = False
            if not self._conversion_running:
                self._sync_action_buttons()

    def force_reset_conversion_ui(self) -> None:
        """Hard-reset action bar state (app exit / orphaned flags)."""
        self._conversion_running = False
        self._starting_conversion = False
        self._stop_pending = False
        self._user_stopped = False
        self._disconnect_worker()
        self.worker = None
        self._task_queue = None
        self.toggle_inputs(True)
        self._sync_action_buttons()
        self._clear_footer_badge_if_idle()

    def stop_process(self):
        if not self._is_converting():
            return
        self._user_stopped = True
        self._stop_pending = True
        self.lbl_local_status.setText(self.tr('status.stop_wait'))
        self._sync_action_buttons()
        if self.worker:
            self.worker.stop()
        else:
            self.on_finished()

    def _mark_cancelled_rows(self) -> None:
        for i in range(self.table_widget.rowCount()):
            if self._row_status_key(i) in ("working", "queued", "pending"):
                self._set_row_status(i, "cancelled")

    def toggle_inputs(self, enable):
        converting = self._is_converting()
        file_ops = enable or converting
        self.btn_add.setEnabled(file_ops)
        self.btn_folder.setEnabled(file_ops)
        self.btn_clear.setEnabled(file_ops)
        self.btn_reset.setEnabled(enable and not converting)
        self.setAcceptDrops(file_ops)
        self.drop_zone.set_interactive(file_ops)
        self.settings_group.setEnabled(enable and not converting)
        if hasattr(self, 'advanced_group'):
            self.advanced_group.setEnabled(enable and not converting)
        if converting:
            set_tip(self.btn_add, self.tr('tip.add_while_running'))
            set_tip(self.btn_folder, self.tr('tip.add_while_running'))
        else:
            set_tip(self.btn_add, self.tr('btn.select_files_tip'))
            set_tip(self.btn_folder, self.tr('btn.select_folder_tip'))
        self._sync_action_buttons()

    def _on_worker_progress(self, value: int) -> None:
        if self._is_converting():
            self.progress_bar.setValue(value)

    def update_local_log(self, msg):
        if self._is_converting():
            self.lbl_local_status.setText(msg)

    def _track_file_result(self, path, status):
        if not self._is_converting():
            return
        if status == "success":
            self._success_count += 1
        elif status not in ("cancelled",):
            self._fail_count += 1

    def update_file_status(self, path, status):
        if not self._is_converting():
            return
        try:
            row = self.file_paths.index(path)
            if status == "success":
                self._set_row_status(row, "success")
            elif status == "cancelled":
                self._set_row_status(row, "cancelled")
            else:
                self._set_row_status(row, "fail")
        except ValueError:
            pass

    def on_finished(self):
        if not self._conversion_running:
            self._sync_action_buttons()
            return
        stopped = self._user_stopped
        self._conversion_running = False
        self._stop_pending = False
        self._disconnect_worker()
        self.worker = None
        self._task_queue = None
        try:
            if stopped:
                self._mark_cancelled_rows()
                self.progress_bar.setValue(0)
            else:
                self.progress_bar.setValue(100)
            self.toggle_inputs(True)
            self._sync_action_buttons()
            self._clear_footer_badge_if_idle()
            if hasattr(self, 'update_pipeline_hint'):
                self.update_pipeline_hint()
            if stopped:
                self._user_stopped = False
                self.lbl_local_status.setText(self.tr('status.stopped'))
                self._sync_action_buttons()
                return
        except Exception:
            self.toggle_inputs(True)
            self._sync_action_buttons()
            self._clear_footer_badge_if_idle()
            raise
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
        self._sync_action_buttons()
        try:
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
        finally:
            self._sync_action_buttons()

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

