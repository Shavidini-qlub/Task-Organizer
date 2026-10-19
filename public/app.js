(function(){
  "use strict";

  // ---------- date helpers (local calendar day, not UTC) ----------
  function toLocalStr(d){
    var tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0,10);
  }
  function todayStr(){ return toLocalStr(new Date()); }
  function dayOffset(dateStr, delta){
    var d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + delta);
    return toLocalStr(d);
  }
  function daysBetween(a, b){
    return Math.round((new Date(b+"T00:00:00") - new Date(a+"T00:00:00")) / 86400000);
  }
  var WEEKDAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtLong(dateStr){
    var d = new Date(dateStr + "T00:00:00");
    return WEEKDAY[d.getDay()] + ", " + MONTH[d.getMonth()] + " " + d.getDate();
  }
  function fmtShort(dateStr){
    var d = new Date(dateStr + "T00:00:00");
    return MONTH[d.getMonth()] + " " + d.getDate();
  }
  // Monday-start week containing dateStr, as its Monday's date string.
  function weekStartOf(dateStr){
    var d = new Date(dateStr + "T00:00:00");
    var dow = d.getDay(); // 0=Sun..6=Sat
    var back = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - back);
    return toLocalStr(d);
  }
  // Calendar month containing dateStr, as that month's 1st day.
  function monthStartOf(dateStr){
    var d = new Date(dateStr + "T00:00:00");
    return toLocalStr(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  function monthEndOf(monthStart){
    var d = new Date(monthStart + "T00:00:00");
    return toLocalStr(new Date(d.getFullYear(), d.getMonth() + 1, 0)); // day 0 of next month = last day of this one
  }
  function nextMonthStart(monthStart){
    var d = new Date(monthStart + "T00:00:00");
    return toLocalStr(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
  function prevMonthStart(monthStart){
    var d = new Date(monthStart + "T00:00:00");
    return toLocalStr(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function fmtMonthLabel(monthStart){
    var d = new Date(monthStart + "T00:00:00");
    return MONTH[d.getMonth()] + " " + d.getFullYear();
  }

  var TODAY = todayStr();
  document.getElementById("todayLabel").textContent = fmtLong(TODAY);
  // History is a log of past days only — today's tasks live on the Today
  // tab, so History never goes past yesterday.
  var histMaxDay = dayOffset(TODAY, -1);

  var histDateInput = document.getElementById("histDate");
  histDateInput.max = histMaxDay;
  histDateInput.value = histMaxDay;

  var THIS_WEEK_START = weekStartOf(TODAY);
  var reviewWeekStart = THIS_WEEK_START;
  var THIS_MONTH_START = monthStartOf(TODAY);
  var reviewMonthStart = THIS_MONTH_START;

  // ---------- boards ----------
  // Boards are fully user-defined (created via the + button) — Today,
  // History and Review are all scoped to whichever board is selected.
  var boards = [];              // {id, name, createdAt, order}
  var boardsCol = null;         // API collection for this user's boards
  var currentBoard = null;      // selected board id
  var defaultBoardAttempted = false;
  var boardFormOpen = false;
  var renamingBoardId = null;
  var confirmModal = null; // {title, message, confirmLabel, onConfirm} — drives the popup confirm dialog
  var priorityMenuTarget = null; // {kind:"composer"|"task", id, top, left} — drives the priority picker popup
  var activeTab = "today"; // "today"|"history"|"completed"|"review"|"monthReview" — which day-strip dot gets highlighted
  var selectMode = false; // Today tab's open-task list: multi-select mode for bulk-moving tasks to another board
  var selectedTaskIds = {}; // {taskId: true} — which open tasks are checked while selectMode is on
  var boardMoveMenuTarget = null; // {top, left} — drives the "move to board" popup
  var BOARD_PALETTE = ["var(--accent)", "var(--personal)", "var(--warn)", "var(--danger)", "var(--good)"];

  function boardIndex(id){
    for (var i = 0; i < boards.length; i++){ if (boards[i].id === id) return i; }
    return 0;
  }
  function boardColor(id){ return BOARD_PALETTE[boardIndex(id) % BOARD_PALETTE.length]; }
  // Resolves a task's stored board id to a real board — tasks created
  // before a matching board existed (or whose board was removed) fall
  // back to the oldest board rather than disappearing.
  function normalizeBoard(id){
    if (boards.some(function(b){ return b.id === id; })) return id;
    return boards.length ? boards[0].id : null;
  }
  function sortBoards(list){
    return list.sort(function(a,b){ return (a.order - b.order) || (a.createdAt - b.createdAt); });
  }
  function ensureDefaultBoard(){
    if (boards.length || defaultBoardAttempted) return;
    defaultBoardAttempted = true;
    createBoard("Tasks");
  }
  function resolveCurrentBoard(){
    if (currentBoard && boards.some(function(b){ return b.id === currentBoard; })) return;
    var saved = null;
    try { saved = localStorage.getItem("rollover_board_v1"); } catch(e){}
    if (saved && boards.some(function(b){ return b.id === saved; })){ currentBoard = saved; return; }
    currentBoard = boards.length ? boards[0].id : null;
  }
  function switchBoard(id){
    if (id === currentBoard) return;
    commitOpenComment();
    currentBoard = id;
    try { localStorage.setItem("rollover_board_v1", id); } catch(e){}
    editingTaskId = null;
    openCommentId = null;
    scheduleEditId = null;
    boardFormOpen = false;
    renamingBoardId = null;
    closeConfirm();
    priorityMenuTarget = null;
    selectMode = false;
    selectedTaskIds = {};
    boardMoveMenuTarget = null;
    render();
  }
  async function createBoard(name){
    name = (name || "").trim();
    if (!name) return;
    if (backend === "db"){
      var ref = await boardsCol.add({ name: name, createdAt: Date.now(), order: boards.length });
      switchBoard(ref.id);
    } else {
      var id = genId();
      boards.push({ id: id, name: name, createdAt: Date.now(), order: boards.length });
      sortBoards(boards);
      localSave("rollover_boards_v1", boards);
      switchBoard(id);
    }
  }
  async function renameBoard(id, name){
    if (backend === "db"){
      await boardsCol.doc(id).update({ name: name });
    } else {
      var b = boards.find(function(x){ return x.id === id; });
      if (b){ b.name = name; localSave("rollover_boards_v1", boards); }
      render();
    }
  }
  function commitRename(id, value){
    var name = (value || "").trim();
    renamingBoardId = null;
    if (name) renameBoard(id, name); else render();
  }
  // Deletes a board along with every task and review note filed under it.
  // If this was the last board, a fresh default one is created right after
  // so the composer always has somewhere to add to.
  async function deleteBoard(id){
    defaultBoardAttempted = false; // allow a new default board if this was the only one
    if (backend === "db"){
      var tasksSnap = await col.where("board", "==", id).get();
      var reviewsSnap = await reviewCol.where("board", "==", id).get();
      var deletes = [];
      tasksSnap.docs.forEach(function(d){ deletes.push(col.doc(d.id).delete()); });
      reviewsSnap.docs.forEach(function(d){ deletes.push(reviewCol.doc(d.id).delete()); });
      deletes.push(boardsCol.doc(id).delete());
      await Promise.all(deletes);
      // boardsCol.onSnapshot picks this up and handles default-board
      // recreation + currentBoard resolution + re-render on its own.
    } else {
      tasks = tasks.filter(function(t){ return t.board !== id; });
      reviews = reviews.filter(function(r){ return r.board !== id; });
      boards = boards.filter(function(b){ return b.id !== id; });
      localSave("rollover_tasks_v1", tasks);
      localSave("rollover_reviews_v1", reviews);
      localSave("rollover_boards_v1", boards);
      if (currentBoard === id){
        currentBoard = null;
        ensureDefaultBoard();
        resolveCurrentBoard();
      }
      editingTaskId = null;
      openCommentId = null;
      selectMode = false;
      selectedTaskIds = {};
      boardMoveMenuTarget = null;
      render();
    }
  }
  function onBoardsChanged(list){
    boards = sortBoards(list);
    ensureDefaultBoard();
    resolveCurrentBoard();
    render();
  }

  // ---------- priority ----------
  // "normal" was the old middle-tier key; normalizePriority() below now
  // falls back to "low" for it, so tasks saved before this rename show as
  // Low instead of silently losing their priority.
  var PRIORITY_ORDER = ["low","medium","high"];
  var PRIORITY_LABEL = { low:"Low", medium:"Medium", high:"High" };
  var PRIORITY_RANK = { high:0, medium:1, low:2 };
  function normalizePriority(p){ return PRIORITY_LABEL[p] ? p : "low"; }

  var composerPriority = "low";
  var priPickEl = document.getElementById("priPick");
  var priPickLabelEl = document.getElementById("priPickLabel");
  function renderPriPick(){
    priPickEl.setAttribute("data-pri", composerPriority);
    priPickLabelEl.textContent = PRIORITY_LABEL[composerPriority];
  }
  priPickEl.addEventListener("mousedown", function(e){
    e.preventDefault();
    if (priorityMenuTarget && priorityMenuTarget.kind === "composer"){ closePriorityMenu(); }
    else { openPriorityMenu("composer", null, priPickEl); }
  });
  renderPriPick();

  // ---------- inline text edit ----------
  var editingTaskId = null;
  function focusEditInputIfNeeded(){
    if (!editingTaskId) return;
    var el = document.querySelector('.edit-input[data-id="' + editingTaskId + '"]');
    if (el){ el.focus(); el.select(); }
  }

  // ---------- comment box ----------
  var openCommentId = null;
  function focusCommentInputIfNeeded(){
    if (!openCommentId) return;
    var el = document.querySelector('.comment-input[data-id="' + openCommentId + '"]');
    if (el){ el.focus(); var len = el.value.length; el.setSelectionRange(len, len); }
  }

  // ---------- storage: "db" = Task Organizer API; "local" branches are a legacy browser-only mode ----------
  var tasks = [];               // in-memory mirror, array of {id, text, status, priority, comment, createdDate, doneDate, createdAt}
  var reviews = [];             // in-memory mirror, array of {id (=weekStart), notes, reviewedAt}
  var backend = null;           // 'db' | 'local'
  var col = null;                // API collection for this user's tasks
  var reviewCol = null;          // API collection for this user's reviews

  function setBanner(msg){
    var el = document.getElementById("statusBanner");
    if (!msg){ el.style.display = "none"; return; }
    el.textContent = msg; el.style.display = "block";
  }

  function localSave(key, list){
    try { localStorage.setItem(key, JSON.stringify(list)); } catch(e){}
  }

  function render(){ renderBoardSwitch(); renderStats(); renderStrip(); renderToday(); renderHistory(); renderCompleted(); renderReview(); renderMonthReview(); renderModal(); renderPriorityMenu(); renderBoardMoveMenu(); focusEditInputIfNeeded(); focusCommentInputIfNeeded(); focusDueInputIfNeeded(); }

  // ---------- confirm modal ----------
  // A custom in-page popup (not window.confirm, which sandboxed artifact
  // iframes can block) used for single-click destructive-action confirms.
  function openConfirm(opts){
    confirmModal = opts;
    renderModal();
  }
  function closeConfirm(){
    if (!confirmModal) return;
    confirmModal = null;
    renderModal();
  }
  function renderModal(){
    var root = document.getElementById("modalRoot");
    if (!root) return;
    root.innerHTML = "";
    if (!confirmModal) return;
    var modal = confirmModal;
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = function(e){ if (e.target === overlay) closeConfirm(); };
    var card = document.createElement("div");
    card.className = "modal-card";
    var title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = modal.title;
    card.appendChild(title);
    var body = document.createElement("div");
    body.className = "modal-body";
    body.textContent = modal.message;
    card.appendChild(body);
    var actions = document.createElement("div");
    actions.className = "modal-actions";
    var cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = function(){ closeConfirm(); };
    actions.appendChild(cancelBtn);
    var confirmBtn = document.createElement("button");
    confirmBtn.className = "modal-btn confirm-danger";
    confirmBtn.textContent = modal.confirmLabel || "Yes, delete";
    confirmBtn.onclick = function(){
      var action = modal.onConfirm;
      closeConfirm();
      if (action) action();
    };
    actions.appendChild(confirmBtn);
    card.appendChild(actions);
    overlay.appendChild(card);
    root.appendChild(overlay);
    setTimeout(function(){ confirmBtn.focus(); }, 0);
  }
  document.addEventListener("keydown", function(e){
    if (confirmModal && e.key === "Escape"){ e.preventDefault(); closeConfirm(); }
    if (priorityMenuTarget && e.key === "Escape"){ e.preventDefault(); closePriorityMenu(); }
    if (boardMoveMenuTarget && e.key === "Escape"){ e.preventDefault(); closeBoardMoveMenu(); }
    if (selectMode && !boardMoveMenuTarget && e.key === "Escape"){ e.preventDefault(); toggleSelectMode(); }
  });

  // ---------- priority picker popup ----------
  // Clicking a priority dot opens a small popup listing High/Medium/Low so
  // the person can jump straight to one, instead of clicking repeatedly to
  // cycle through them. Position is computed once at open time from the
  // trigger button's own rect (position:fixed, so no scroll-offset math
  // needed) and clamped so the popup never runs off the viewport.
  var PRIORITY_MENU_WIDTH = 132;
  function openPriorityMenu(kind, id, anchorEl){
    var rect = anchorEl.getBoundingClientRect();
    var estHeight = 3 * 33 + 8; // three rows plus padding
    var left = Math.min(rect.left, window.innerWidth - PRIORITY_MENU_WIDTH - 8);
    left = Math.max(8, left);
    var top;
    if (rect.bottom + estHeight + 8 <= window.innerHeight){
      top = rect.bottom + 6;
    } else {
      top = Math.max(8, rect.top - estHeight - 6);
    }
    priorityMenuTarget = { kind: kind, id: id, top: top, left: left };
    renderPriorityMenu();
  }
  function closePriorityMenu(){
    if (!priorityMenuTarget) return;
    priorityMenuTarget = null;
    renderPriorityMenu();
  }
  function choosePriority(value){
    var target = priorityMenuTarget;
    closePriorityMenu();
    if (!target) return;
    if (target.kind === "composer"){
      composerPriority = value;
      renderPriPick();
    } else {
      setTaskPriority(target.id, value);
    }
  }
  function renderPriorityMenu(){
    var root = document.getElementById("priorityMenuRoot");
    if (!root) return;
    root.innerHTML = "";
    var target = priorityMenuTarget;
    if (!target) return;
    var current;
    if (target.kind === "composer"){
      current = composerPriority;
    } else {
      var t = tasks.find(function(x){ return x.id === target.id; });
      if (!t){ priorityMenuTarget = null; return; } // task gone (e.g. deleted mid-pick) — nothing to show
      current = normalizePriority(t.priority);
    }
    var menu = document.createElement("div");
    menu.className = "priority-menu";
    menu.style.top = target.top + "px";
    menu.style.left = target.left + "px";
    PRIORITY_ORDER.forEach(function(p){
      var item = document.createElement("button");
      item.type = "button";
      item.className = "priority-menu-item" + (p === current ? " active" : "");
      item.setAttribute("data-pri", p);
      item.innerHTML = '<span class="pri-dot"></span><span>' + PRIORITY_LABEL[p] + "</span>" +
        (p === current ? '<span class="check-mark">' + checkSvg() + "</span>" : "");
      item.addEventListener("mousedown", function(e){ e.preventDefault(); choosePriority(p); });
      menu.appendChild(item);
    });
    root.appendChild(menu);
  }

  // ---------- bulk select + move to another board ----------
  // "Select" on the Today tab's Open group turns each row's drag handle
  // into a checkbox (dragging and multi-select don't mix, so reordering is
  // off for the duration) and swaps the group's header for a small toolbar:
  // how many are checked, a "Move to board" trigger, and a way to cancel.
  // Picking a board from that popup moves every checked task there in one
  // go and drops back out of select mode — built for reassigning a batch
  // of mis-filed tasks (e.g. several "QR - …" tasks) to the right board at
  // once, rather than moving them one at a time.
  function toggleSelectMode(){
    selectMode = !selectMode;
    selectedTaskIds = {};
    boardMoveMenuTarget = null;
    render();
  }
  function toggleTaskSelected(id){
    if (selectedTaskIds[id]) delete selectedTaskIds[id];
    else selectedTaskIds[id] = true;
    render();
  }
  function selectedCount(){
    return Object.keys(selectedTaskIds).length;
  }
  var BOARD_MOVE_MENU_WIDTH = 190;
  function openBoardMoveMenu(anchorEl){
    if (!selectedCount()) return;
    var otherCount = boards.filter(function(b){ return b.id !== currentBoard; }).length;
    var rect = anchorEl.getBoundingClientRect();
    var estHeight = Math.max(1, Math.min(otherCount, 6)) * 33 + 8;
    var left = Math.min(rect.left, window.innerWidth - BOARD_MOVE_MENU_WIDTH - 8);
    left = Math.max(8, left);
    var top;
    if (rect.bottom + estHeight + 8 <= window.innerHeight){
      top = rect.bottom + 6;
    } else {
      top = Math.max(8, rect.top - estHeight - 6);
    }
    boardMoveMenuTarget = { top: top, left: left };
    renderBoardMoveMenu();
  }
  function closeBoardMoveMenu(){
    if (!boardMoveMenuTarget) return;
    boardMoveMenuTarget = null;
    renderBoardMoveMenu();
  }
  // Moves every currently-checked task to `targetBoardId` in one batch,
  // then drops out of select mode — the moved tasks vanish from this board's
  // lists on the next render since tasksForBoard() filters by board id.
  async function moveSelectedTasksToBoard(targetBoardId){
    var ids = Object.keys(selectedTaskIds);
    boardMoveMenuTarget = null;
    selectMode = false;
    selectedTaskIds = {};
    if (!ids.length) { render(); return; }
    if (backend === "db"){
      await Promise.all(ids.map(function(id){ return col.doc(id).update({ board: targetBoardId }); }));
      // col.onSnapshot picks the change up and re-renders on its own.
    } else {
      ids.forEach(function(id){
        var t = tasks.find(function(x){ return x.id === id; });
        if (t) t.board = targetBoardId;
      });
      localSave("rollover_tasks_v1", tasks);
      render();
    }
  }
  function renderBoardMoveMenu(){
    var root = document.getElementById("boardMoveMenuRoot");
    if (!root) return;
    root.innerHTML = "";
    var target = boardMoveMenuTarget;
    if (!target) return;
    var otherBoards = boards.filter(function(b){ return b.id !== currentBoard; });
    var menu = document.createElement("div");
    menu.className = "board-move-menu";
    menu.style.top = target.top + "px";
    menu.style.left = target.left + "px";
    if (!otherBoards.length){
      var empty = document.createElement("div");
      empty.className = "board-move-empty";
      empty.textContent = "No other boards yet — add one first.";
      menu.appendChild(empty);
    } else {
      otherBoards.forEach(function(b){
        var item = document.createElement("button");
        item.type = "button";
        item.className = "board-move-item";
        var dot = document.createElement("span");
        dot.className = "board-dot";
        dot.style.background = boardColor(b.id);
        item.appendChild(dot);
        var name = document.createElement("span");
        name.className = "board-move-name";
        name.textContent = b.name;
        item.appendChild(name);
        item.addEventListener("mousedown", function(e){ e.preventDefault(); moveSelectedTasksToBoard(b.id); });
        menu.appendChild(item);
      });
    }
    root.appendChild(menu);
  }

  // The artifact runs in a sandboxed iframe where a plain `blur` on a text
  // field doesn't reliably fire for every "click somewhere else" interaction,
  // so every open, unsaved text field here is also flushed by this
  // capture-phase pointerdown listener. Capture means it runs before any
  // click handler elsewhere (switching boards, opening another task's note,
  // etc.) gets a chance to re-render and silently discard what's still typed.
  document.addEventListener("pointerdown", function(e){
    // A click on a task's own note-toggle button is left entirely to
    // toggleComment() below — it already knows whether that's "close this
    // one" or "switch to a different task's note" and handles saving either
    // way; flushing here too would race it and could make the box pop back
    // open right after this same click closes it.
    if (openCommentId && !e.target.closest(".comment-btn")){
      var commentEl = document.querySelector('.comment-input[data-id="' + openCommentId + '"]');
      if (commentEl && !commentEl.contains(e.target)){
        updateTaskComment(openCommentId, commentEl.value);
        openCommentId = null;
        render();
      }
    }
    if (editingTaskId && !e.target.closest(".icon-btn.save") && !e.target.closest(".icon-btn.cancel")){
      var editEl = document.querySelector('.edit-input[data-id="' + editingTaskId + '"]');
      if (editEl && !editEl.contains(e.target)) commitEdit(editingTaskId, editEl.value);
    }
    if (renamingBoardId){
      var renameEl = document.querySelector(".board-rename-input");
      if (renameEl && !renameEl.contains(e.target)) commitRename(renamingBoardId, renameEl.value);
    }
    if (boardFormOpen){
      var boardEl = document.querySelector(".board-new-input");
      if (boardEl && !boardEl.contains(e.target)) commitNewBoard(boardEl.value);
    }
    // The schedule editor closes (and saves) on any click outside it (its own toggle
    // button handles itself).
    if (scheduleEditId && !e.target.closest(".due-btn")){
      var dueBox = document.querySelector(".schedule-edit");
      if (dueBox && !dueBox.contains(e.target)) commitScheduleEdit();
    }
    // A click on a priority dot is left to its own mousedown handler below
    // (it toggles the popup); anything else outside the open popup closes it.
    if (priorityMenuTarget && !e.target.closest(".pri-pick") && !e.target.closest(".pri-cycle")){
      var menuEl = document.querySelector(".priority-menu");
      if (menuEl && !menuEl.contains(e.target)) closePriorityMenu();
    }
    // Same pattern for the "move to board" popup — its own trigger button
    // handles opening/toggling it, so only an outside click closes it here.
    if (boardMoveMenuTarget && !e.target.closest(".move-trigger")){
      var boardMenuEl = document.querySelector(".board-move-menu");
      if (boardMenuEl && !boardMenuEl.contains(e.target)) closeBoardMoveMenu();
    }
  }, true);

  function onTasksChanged(list){
    tasks = list;
    render();
  }
  function onReviewsChanged(list){
    reviews = list;
    renderReview();
    renderMonthReview();
  }

  function genId(){ return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

  async function addTask(text){
    text = text.trim();
    if (!text || !currentBoard) return;
    var dueEl = document.getElementById("newTaskDue");
    var dueDate = dueEl.value || null;
    dueEl.value = "";
    var body = { text: text, status: "open", priority: composerPriority, comment: "", board: currentBoard, createdDate: TODAY, doneDate: null, dueDate: dueDate, createdAt: Date.now() };
    if (backend === "db"){
      await col.add(body);
    } else {
      body.id = genId();
      tasks.push(body);
      localSave("rollover_tasks_v1", tasks);
      render();
    }
    composerPriority = "low";
    renderPriPick();
  }

  async function completeTask(id){
    if (backend === "db"){
      await col.doc(id).update({ status: "done", doneDate: TODAY });
    } else {
      var t = tasks.find(function(x){ return x.id === id; });
      if (t){ t.status = "done"; t.doneDate = TODAY; localSave("rollover_tasks_v1", tasks); render(); }
    }
  }

  async function reopenTask(id){
    if (backend === "db"){
      await col.doc(id).update({ status: "open", doneDate: null });
    } else {
      var t = tasks.find(function(x){ return x.id === id; });
      if (t){ t.status = "open"; t.doneDate = null; localSave("rollover_tasks_v1", tasks); render(); }
    }
  }

  async function setTaskPriority(id, value){
    if (!PRIORITY_LABEL[value]) return;
    if (backend === "db"){
      await col.doc(id).update({ priority: value });
    } else {
      var t = tasks.find(function(x){ return x.id === id; });
      if (t){ t.priority = value; localSave("rollover_tasks_v1", tasks); render(); }
    }
  }

  async function updateTaskText(id, text){
    text = text.trim();
    if (!text) return;
    if (backend === "db"){
      await col.doc(id).update({ text: text });
    } else {
      var t = tasks.find(function(x){ return x.id === id; });
      if (t){ t.text = text; localSave("rollover_tasks_v1", tasks); }
    }
  }

  function startEdit(id){
    commitOpenComment();
    editingTaskId = id;
    render();
  }
  function cancelEdit(){
    editingTaskId = null;
    render();
  }
  async function commitEdit(id, value){
    var text = (value || "").trim();
    editingTaskId = null;
    if (text) await updateTaskText(id, text);
    render();
  }

  async function updateTaskComment(id, text){
    text = (text || "").trim();
    if (backend === "db"){
      await col.doc(id).update({ comment: text });
    } else {
      var t = tasks.find(function(x){ return x.id === id; });
      if (t){ t.comment = text; localSave("rollover_tasks_v1", tasks); }
    }
  }
  // Whatever is currently typed in the open comment box is saved before the
  // box gets torn down by a re-render — clicking the edit-task pencil,
  // opening a different task's note, switching boards, etc. all route
  // through this rather than relying on the textarea's own blur alone.
  function commitOpenComment(){
    if (!openCommentId) return;
    var el = document.querySelector('.comment-input[data-id="' + openCommentId + '"]');
    if (el) updateTaskComment(openCommentId, el.value);
  }
  function openComment(id){
    openCommentId = id;
    render();
  }
  async function toggleComment(id){
    if (openCommentId === id){
      var el = document.querySelector('.comment-input[data-id="' + id + '"]');
      if (el){ await updateTaskComment(id, el.value); }
      openCommentId = null;
    } else {
      commitOpenComment();
      openCommentId = id;
    }
    render();
  }

  async function deleteTask(id){
    if (backend === "db"){
      await col.doc(id).delete();
    } else {
      tasks = tasks.filter(function(x){ return x.id !== id; });
      localSave("rollover_tasks_v1", tasks);
      render();
    }
  }

  // ---------- reviews ----------
  // Review docs are keyed per board + week, so each board keeps its own
  // weekly review notes and reviewed-flag.
  function reviewDocId(weekStart){ return currentBoard + "_" + weekStart; }
  function reviewFor(weekStart){
    var docId = reviewDocId(weekStart);
    return reviews.find(function(r){ return r.id === docId; }) || { id: docId, notes: "", reviewedAt: null };
  }
  var notesSaveTimer = null;
  async function saveReviewNotes(weekStart, notes){
    var docId = reviewDocId(weekStart);
    var existing = reviewFor(weekStart);
    var body = { board: currentBoard, notes: notes, reviewedAt: existing.reviewedAt || null };
    if (backend === "db"){
      await reviewCol.doc(docId).set(body);
    } else {
      var idx = reviews.findIndex(function(r){ return r.id === docId; });
      var rec = { id: docId, board: body.board, notes: body.notes, reviewedAt: body.reviewedAt };
      if (idx >= 0) reviews[idx] = rec; else reviews.push(rec);
      localSave("rollover_reviews_v1", reviews);
    }
  }
  async function toggleReviewed(weekStart){
    var docId = reviewDocId(weekStart);
    var existing = reviewFor(weekStart);
    var body = { board: currentBoard, notes: existing.notes || "", reviewedAt: existing.reviewedAt ? null : Date.now() };
    if (backend === "db"){
      await reviewCol.doc(docId).set(body);
    } else {
      var idx = reviews.findIndex(function(r){ return r.id === docId; });
      var rec = { id: docId, board: body.board, notes: body.notes, reviewedAt: body.reviewedAt };
      if (idx >= 0) reviews[idx] = rec; else reviews.push(rec);
      localSave("rollover_reviews_v1", reviews);
      renderReview();
    }
  }

  // Monthly review notes share the same reviews collection as the weekly
  // ones, kept apart by an "_m_" marker in the doc id — weekly ids are
  // always "<board>_<weekStart date>", so this can never collide with one.
  function monthReviewDocId(monthStart){ return currentBoard + "_m_" + monthStart; }
  function monthReviewFor(monthStart){
    var docId = monthReviewDocId(monthStart);
    return reviews.find(function(r){ return r.id === docId; }) || { id: docId, notes: "", reviewedAt: null };
  }
  var monthNotesSaveTimer = null;
  async function saveMonthReviewNotes(monthStart, notes){
    var docId = monthReviewDocId(monthStart);
    var existing = monthReviewFor(monthStart);
    var body = { board: currentBoard, notes: notes, reviewedAt: existing.reviewedAt || null };
    if (backend === "db"){
      await reviewCol.doc(docId).set(body);
    } else {
      var idx = reviews.findIndex(function(r){ return r.id === docId; });
      var rec = { id: docId, board: body.board, notes: body.notes, reviewedAt: body.reviewedAt };
      if (idx >= 0) reviews[idx] = rec; else reviews.push(rec);
      localSave("rollover_reviews_v1", reviews);
    }
  }
  async function toggleMonthReviewed(monthStart){
    var docId = monthReviewDocId(monthStart);
    var existing = monthReviewFor(monthStart);
    var body = { board: currentBoard, notes: existing.notes || "", reviewedAt: existing.reviewedAt ? null : Date.now() };
    if (backend === "db"){
      await reviewCol.doc(docId).set(body);
    } else {
      var idx = reviews.findIndex(function(r){ return r.id === docId; });
      var rec = { id: docId, board: body.board, notes: body.notes, reviewedAt: body.reviewedAt };
      if (idx >= 0) reviews[idx] = rec; else reviews.push(rec);
      localSave("rollover_reviews_v1", reviews);
      renderMonthReview();
    }
  }

  // ---------- due dates ----------
  // A task's due date is optional. Open tasks show how close it is; the
  // badge and the "due / overdue" stat update by themselves as days pass.
  function isDueNow(t){
    return t.status === "open" && !!t.dueDate && t.dueDate <= TODAY;
  }
  // asOfDay is set for History's frozen rows, which just show the date.
  function dueInfo(t, asOfDay){
    if (!t.dueDate) return null;
    if (t.status !== "open" || asOfDay) return { cls: "", label: "due " + fmtShort(t.dueDate) };
    var diff = daysBetween(TODAY, t.dueDate);
    if (diff < 0) return { cls: "due-overdue", label: "overdue " + (-diff) + "d · due " + fmtShort(t.dueDate) };
    if (diff === 0) return { cls: "due-today", label: "due today" };
    if (diff === 1) return { cls: "due-soon", label: "due tomorrow" };
    if (diff <= 6) return { cls: "due-soon", label: "due " + WEEKDAY[new Date(t.dueDate + "T00:00:00").getDay()] + " " + fmtShort(t.dueDate) };
    return { cls: "", label: "due " + fmtShort(t.dueDate) };
  }
  async function updateTask(id, patch){
    if (backend === "db"){
      await col.doc(id).update(patch);
    } else {
      var t = tasks.find(function(x){ return x.id === id; });
      if (t){ Object.assign(t, patch); localSave("rollover_tasks_v1", tasks); render(); }
    }
  }

  // ---------- snooze + repeat ----------
  // A snoozed task stays off Today until its date, then comes back on its own
  // (nothing runs at midnight; it's worked out from the date, like
  // carry-over). It wakes early if its due date arrives first, so snoozing
  // can never hide a deadline.
  function isSnoozed(t){
    return t.status === "open" && !!t.snoozedUntil && t.snoozedUntil > TODAY && !isDueNow(t);
  }
  // Repeating tasks: when one is completed, the server adds the next copy,
  // snoozed until its day.
  var REPEAT_OPTIONS = [["", "Doesn't repeat"], ["daily", "Every day"], ["weekdays", "Every weekday"], ["weekly", "Every week"], ["monthly", "Every month"]];
  function fmtDay(dateStr){
    var diff = daysBetween(TODAY, dateStr);
    if (diff === 1) return "tomorrow";
    if (diff > 1 && diff <= 6) return WEEKDAY[new Date(dateStr + "T00:00:00").getDay()] + " " + fmtShort(dateStr);
    return fmtShort(dateStr);
  }
  function nextMondayFrom(day){
    var dow = new Date(day + "T00:00:00").getDay();
    return dayOffset(day, dow === 1 ? 7 : ((8 - dow) % 7 || 7));
  }

  // ---------- schedule editor (due date · snooze · repeat) ----------
  var scheduleEditId = null;       // task whose schedule editor is open
  var scheduleJustOpened = false;  // focus the first field only when it opens
  // Typed dates are saved when the editor closes (Enter, click away, or the
  // calendar button again): saving on every change would re-render mid-typing
  // and lock in a half-typed date. Buttons and the repeat menu save at once.
  function schedulePatchFromEditor(t){
    var box = document.querySelector('.schedule-edit[data-id="' + t.id + '"]');
    var patch = {};
    if (!box) return patch;
    var due = box.querySelector(".due-input").value;
    if (due && due !== t.dueDate) patch.dueDate = due;
    var snooze = box.querySelector(".snooze-input").value;
    if (snooze && snooze > TODAY && snooze !== t.snoozedUntil) patch.snoozedUntil = snooze;
    return patch;
  }
  function commitScheduleEdit(extra, keepOpen){
    if (!scheduleEditId) return;
    var id = scheduleEditId;
    var t = tasks.find(function(x){ return x.id === id; });
    var patch = t ? Object.assign(schedulePatchFromEditor(t), extra || {}) : {};
    if (!keepOpen) scheduleEditId = null;
    if (t && Object.keys(patch).length) updateTask(id, patch);
    render();
  }
  function toggleScheduleEdit(id){
    var wasOpen = scheduleEditId === id;
    commitScheduleEdit();
    if (wasOpen) return;
    commitOpenComment();
    openCommentId = null;
    scheduleEditId = id;
    scheduleJustOpened = true;
    render();
  }
  function focusDueInputIfNeeded(){
    if (!scheduleEditId || !scheduleJustOpened) return;
    scheduleJustOpened = false;
    var el = document.querySelector('.schedule-edit[data-id="' + scheduleEditId + '"] .due-input');
    if (el) el.focus();
  }
  function scheduleEditor(t){
    var wrap = document.createElement("div");
    wrap.className = "schedule-edit";
    wrap.setAttribute("data-id", t.id);
    function row(label){
      var r = document.createElement("div");
      r.className = "sched-row";
      var l = document.createElement("span");
      l.className = "sched-label";
      l.textContent = label;
      r.appendChild(l);
      wrap.appendChild(r);
      return r;
    }
    function btn(parent, text, onPick, cls){
      var b = document.createElement("button");
      b.type = "button";
      b.className = cls || "sched-chip";
      b.textContent = text;
      // mousedown + preventDefault so the typed fields keep their values
      b.addEventListener("mousedown", function(e){ e.preventDefault(); onPick(); });
      parent.appendChild(b);
      return b;
    }
    function dateInput(cls, value, label){
      var i = document.createElement("input");
      i.type = "date";
      i.className = cls;
      i.value = value || "";
      i.setAttribute("aria-label", label);
      i.addEventListener("keydown", function(e){
        if (e.key === "Enter"){ e.preventDefault(); commitScheduleEdit(); }
        else if (e.key === "Escape"){ e.preventDefault(); scheduleEditId = null; render(); }
      });
      return i;
    }

    var dueRow = row("Due");
    dueRow.appendChild(dateInput("due-input", t.dueDate, "Due date"));
    if (t.dueDate) btn(dueRow, "Remove", function(){ commitScheduleEdit({ dueDate: null }); }, "due-clear");

    var snoozeRow = row("Snooze");
    btn(snoozeRow, "Tomorrow", function(){ commitScheduleEdit({ snoozedUntil: dayOffset(TODAY, 1) }); });
    btn(snoozeRow, "Monday", function(){ commitScheduleEdit({ snoozedUntil: nextMondayFrom(TODAY) }); });
    btn(snoozeRow, "Next week", function(){ commitScheduleEdit({ snoozedUntil: dayOffset(TODAY, 7) }); });
    var snoozeInput = dateInput("snooze-input", isSnoozed(t) ? t.snoozedUntil : "", "Snooze until");
    snoozeInput.min = dayOffset(TODAY, 1);
    snoozeRow.appendChild(snoozeInput);
    if (isSnoozed(t)) btn(snoozeRow, "Unsnooze", function(){ commitScheduleEdit({ snoozedUntil: null }); }, "due-clear");

    var repeatRow = row("Repeat");
    var sel = document.createElement("select");
    sel.className = "repeat-select";
    sel.setAttribute("aria-label", "Repeat");
    REPEAT_OPTIONS.forEach(function(o){
      var opt = document.createElement("option");
      opt.value = o[0];
      opt.textContent = o[1];
      if ((t.repeat || "") === o[0]) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function(){ commitScheduleEdit({ repeat: sel.value || null }, true); });
    repeatRow.appendChild(sel);
    return wrap;
  }

  // ---------- derived views ----------
  function priorityCompare(a, b){
    // Open tasks that are overdue or due today come first, so deadlines
    // can't hide below newer work.
    var ua = isDueNow(a) ? 0 : 1, ub = isDueNow(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    var ra = PRIORITY_RANK[normalizePriority(a.priority)];
    var rb = PRIORITY_RANK[normalizePriority(b.priority)];
    if (ra !== rb) return ra - rb;
    // Then the nearest due date; tasks without one go after those with one.
    if ((a.dueDate || "") !== (b.dueDate || "")){
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    // Within the same priority, the most recently added task shows first.
    if (a.createdDate !== b.createdDate) return a.createdDate < b.createdDate ? 1 : -1;
    return b.createdAt - a.createdAt;
  }
  // Every view is scoped to the currently selected board — Official and
  // Personal are entirely separate task lists sharing one page.
  function tasksForBoard(board){
    var b = board || currentBoard;
    return tasks.filter(function(t){ return normalizeBoard(t.board) === b; });
  }
  function openCountForBoard(board){
    return tasksForBoard(board).filter(function(t){ return t.status === "open" && !isSnoozed(t); }).length;
  }
  function openTasksSorted(){
    // Tasks added today always sit above carried-over tasks from earlier
    // days; each of those two groups is then ordered by priority on its own —
    // unless this board has been switched into manual order (see the manual
    // task ordering section below), in which case each group keeps whatever
    // order was last set by hand instead.
    var open = tasksForBoard().filter(function(t){ return t.status === "open" && !isSnoozed(t); });
    var cmp = isManualOrder() ? manualOrderCompare : priorityCompare;
    var addedToday = open.filter(function(t){ return t.createdDate >= TODAY; }).sort(cmp);
    var carriedOver = open.filter(function(t){ return t.createdDate < TODAY; }).sort(cmp);
    return addedToday.concat(carriedOver);
  }
  function snoozedTasksSorted(){
    return tasksForBoard().filter(isSnoozed).sort(function(a, b){
      return a.snoozedUntil === b.snoozedUntil ? priorityCompare(a, b) : (a.snoozedUntil < b.snoozedUntil ? -1 : 1);
    });
  }
  function doneTodaySorted(){
    return tasksForBoard().filter(function(t){ return t.status === "done" && t.doneDate === TODAY; })
      .sort(function(a,b){ return b.createdAt - a.createdAt; });
  }
  function tasksOnDay(dateStr){
    return tasksForBoard().filter(function(t){
      // Tasks added today live on the Today tab; History is a log of past
      // days, so a brand-new task shouldn't also show up there, even when
      // History is browsed to today's own date.
      if (t.createdDate === TODAY) return false;
      if (t.createdDate > dateStr) return false;
      if (t.status === "open") return true;
      return t.doneDate && t.doneDate >= dateStr;
    }).sort(function(a,b){ return a.createdDate === b.createdDate ? (a.createdAt - b.createdAt) : (a.createdDate < b.createdDate ? -1 : 1); });
  }
  function dayHasOpenAt(dateStr){
    // true if, looking back at dateStr, anything created on/before it was still open at end of that day
    return tasksForBoard().some(function(t){
      if (t.createdDate > dateStr) return false;
      if (t.status === "open") return true;
      return t.doneDate && t.doneDate > dateStr;
    });
  }
  function dayHasAny(dateStr){
    return tasksForBoard().some(function(t){ return t.createdDate <= dateStr && (t.status === "open" || (t.doneDate && t.doneDate >= dateStr)); });
  }
  function tasksDoneInWeek(weekStart){
    var end = dayOffset(weekStart, 6);
    return tasksForBoard().filter(function(t){ return t.status === "done" && t.doneDate && t.doneDate >= weekStart && t.doneDate <= end; })
      .sort(priorityCompare);
  }
  function tasksStillOpenFromWeek(weekStart){
    var end = dayOffset(weekStart, 6);
    return tasksForBoard().filter(function(t){ return t.status === "open" && t.createdDate >= weekStart && t.createdDate <= end; })
      .sort(priorityCompare);
  }
  function tasksDoneInMonth(monthStart){
    var end = monthEndOf(monthStart);
    return tasksForBoard().filter(function(t){ return t.status === "done" && t.doneDate && t.doneDate >= monthStart && t.doneDate <= end; })
      .sort(priorityCompare);
  }
  function tasksStillOpenFromMonth(monthStart){
    var end = monthEndOf(monthStart);
    return tasksForBoard().filter(function(t){ return t.status === "open" && t.createdDate >= monthStart && t.createdDate <= end; })
      .sort(priorityCompare);
  }
  // Every completed task on this board, no matter when it was added or
  // finished — most recently completed first.
  function allDoneTasksSorted(){
    return tasksForBoard().filter(function(t){ return t.status === "done"; })
      .sort(function(a,b){
        var ad = a.doneDate || "", bd = b.doneDate || "";
        if (ad !== bd) return ad < bd ? 1 : -1;
        return b.createdAt - a.createdAt;
      });
  }

  // ---------- manual task ordering ----------
  // Open tasks sort by priority by default, same as always. Moving one with
  // the up/down buttons, or by dragging it, switches that board into "manual
  // order" mode: from then on each open-task group (today-added, or carried-
  // over — the same two groups openTasksSorted() always keeps separate) is
  // ordered exactly the way it was last left, instead of being recomputed by
  // priority. A "Reset to priority sort" control switches a board back.
  function isManualOrder(){
    var b = boards.find(function(x){ return x.id === currentBoard; });
    return !!(b && b.manualSort);
  }
  // A High or Medium task always sits above its Low-priority siblings in
  // this group, no matter when that priority was set or how long ago the
  // group was last dragged — High above Medium, both above every Low task.
  // Only within a tier (high-vs-high, medium-vs-medium, or among the Lows)
  // does manualOrder — then createdAt — break the tie, which is what lets
  // a drag still reorder tasks that share a tier. Because this is the live
  // comparator behind every manual-order render rather than a one-time move
  // applied when a priority changes, a task that already had High or Medium
  // priority before this behavior existed floats to the top the moment the
  // page next renders — no re-save or migration of existing tasks needed.
  function manualOrderCompare(a, b){
    var pa = normalizePriority(a.priority), pb = normalizePriority(b.priority);
    var pinnedA = pa === "high" || pa === "medium";
    var pinnedB = pb === "high" || pb === "medium";
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
    if (pinnedA && pinnedB && pa !== pb) return PRIORITY_RANK[pa] - PRIORITY_RANK[pb];
    var oa = typeof a.manualOrder === "number" ? a.manualOrder : 0;
    var ob = typeof b.manualOrder === "number" ? b.manualOrder : 0;
    if (oa !== ob) return oa - ob;
    return a.createdAt - b.createdAt; // stable tiebreaker for never-ordered tasks
  }
  async function setBoardManualSort(value){
    if (backend === "db"){
      await boardsCol.doc(currentBoard).update({ manualSort: value });
    } else {
      var b = boards.find(function(x){ return x.id === currentBoard; });
      if (b) b.manualSort = value;
    }
  }
  async function writeTaskOrders(list){ // [{id, manualOrder}]
    if (backend === "db"){
      await Promise.all(list.map(function(x){ return col.doc(x.id).update({ manualOrder: x.manualOrder }); }));
    } else {
      list.forEach(function(x){
        var t = tasks.find(function(y){ return y.id === x.id; });
        if (t) t.manualOrder = x.manualOrder;
      });
      localSave("rollover_boards_v1", boards);
      localSave("rollover_tasks_v1", tasks);
      render();
    }
  }
  // The open-task group (today-added, or carried-over) `t` belongs to, in
  // whatever order is currently on screen for it — exactly what
  // openTasksSorted() would show for that group right now.
  function currentGroupOrder(t){
    var open = tasksForBoard().filter(function(x){ return x.status === "open" && !isSnoozed(x) && (x.createdDate >= TODAY) === (t.createdDate >= TODAY); });
    return open.sort(isManualOrder() ? manualOrderCompare : priorityCompare);
  }
  async function commitGroupOrder(group){
    await setBoardManualSort(true);
    await writeTaskOrders(group.map(function(t, i){ return { id: t.id, manualOrder: i }; }));
  }
  var dragTaskId = null;
  function handleDragStart(id){ dragTaskId = id; }
  async function handleDrop(targetId){
    var draggedId = dragTaskId;
    dragTaskId = null;
    if (!draggedId || draggedId === targetId) return;
    var dragged = tasks.find(function(x){ return x.id === draggedId; });
    var target = tasks.find(function(x){ return x.id === targetId; });
    if (!dragged || !target) return;
    if ((dragged.createdDate >= TODAY) !== (target.createdDate >= TODAY)) return; // no cross-group drops
    var group = currentGroupOrder(dragged);
    var fromIdx = group.findIndex(function(x){ return x.id === draggedId; });
    var toIdx = group.findIndex(function(x){ return x.id === targetId; });
    if (fromIdx === -1 || toIdx === -1) return;
    group.splice(fromIdx, 1);
    group.splice(toIdx, 0, dragged);
    await commitGroupOrder(group);
  }
  async function resetManualOrder(){
    await setBoardManualSort(false);
    render();
  }

  // ---------- rendering ----------
  function checkSvg(){
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>';
  }
  function trashSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9.4A1.5 1.5 0 0 0 7.6 17h4.8a1.5 1.5 0 0 0 1.5-1.6L14.5 6"/></svg>';
  }
  function undoSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h8.5a3.5 3.5 0 1 1 0 7H9"/><path d="M7 5 4 8l3 3"/></svg>';
  }
  function flagSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v14M5 4h8l-2 3 2 3H5"/></svg>';
  }
  function pencilSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5 16.5 6.5 7 16 3.5 16.5 4 13Z"/><path d="M11.5 5.5l3 3"/></svg>';
  }
  function closeSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l10 10M15 5 5 15"/></svg>';
  }
  function commentSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v6A1.5 1.5 0 0 1 15.5 13H8l-3.5 3v-3H4.5A1.5 1.5 0 0 1 3 11.5Z"/></svg>';
  }
  function calendarSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="13" height="12" rx="2"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/></svg>';
  }
  function plusSvg(){
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v12M4 10h12"/></svg>';
  }
  function dragHandleSvg(){
    return '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="7" cy="5" r="1.3"/><circle cx="13" cy="5" r="1.3"/><circle cx="7" cy="10" r="1.3"/><circle cx="13" cy="10" r="1.3"/><circle cx="7" cy="15" r="1.3"/><circle cx="13" cy="15" r="1.3"/></svg>';
  }

  function taskRow(t, opts){
    opts = opts || {};
    var carried = !opts.frozen && t.status === "open" && t.createdDate < TODAY && !isSnoozed(t);
    var frozenDone = !!opts.frozenDone; // history: shown as done as-of that historical day
    var isDone = opts.frozen ? frozenDone : t.status === "done";
    var priority = normalizePriority(t.priority);
    var isEditing = !opts.frozen && editingTaskId === t.id;
    var reorderable = !!opts.reorderable; // only the Today tab's open-task list can be reordered
    var selectable = !!opts.selectable; // Today tab's open-task list while bulk-select mode is on
    var isSelected = selectable && !!selectedTaskIds[t.id];

    var li = document.createElement("li");
    li.className = "task" + (carried ? " carried" : "") + (isDone ? " done" : "") + (priority === "high" && !isDone ? " pri-high" : "") + (isSelected ? " row-selected" : "");

    if (selectable){
      // Bulk-select mode replaces the drag handle with a checkbox — dragging
      // and multi-select don't mix, so reordering is off while this is on.
      var selBtn = document.createElement("button");
      selBtn.type = "button";
      selBtn.className = "select-checkbox" + (isSelected ? " checked" : "");
      selBtn.setAttribute("aria-label", isSelected ? "Deselect task" : "Select task");
      selBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
      if (isSelected) selBtn.innerHTML = checkSvg();
      selBtn.onclick = function(){ toggleTaskSelected(t.id); };
      li.appendChild(selBtn);
    } else if (reorderable){
      // Drag-and-drop reordering — grab the handle (or anywhere on the row)
      // and drop it on another task in the same group to reorder.
      li.draggable = true;
      li.addEventListener("dragstart", function(e){
        handleDragStart(t.id);
        li.classList.add("dragging");
        if (e.dataTransfer){ e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", t.id); } catch(err){} }
      });
      li.addEventListener("dragend", function(){ li.classList.remove("dragging"); });
      li.addEventListener("dragover", function(e){ e.preventDefault(); li.classList.add("drag-over"); });
      li.addEventListener("dragleave", function(){ li.classList.remove("drag-over"); });
      li.addEventListener("drop", function(e){ e.preventDefault(); li.classList.remove("drag-over"); handleDrop(t.id); });

      var handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      handle.innerHTML = dragHandleSvg();
      li.appendChild(handle);
    }

    var check = document.createElement("button");
    check.className = "check";
    check.innerHTML = checkSvg();
    check.setAttribute("aria-label", isDone ? "Mark as not done" : "Mark as done");
    if (!opts.frozen){
      check.onclick = function(){ isDone ? reopenTask(t.id) : completeTask(t.id); };
    } else {
      check.disabled = true;
      check.style.cursor = "default";
    }
    li.appendChild(check);

    var body = document.createElement("div");
    body.className = "task-body";
    if (isEditing){
      var editInput = document.createElement("input");
      editInput.type = "text";
      editInput.className = "edit-input";
      editInput.setAttribute("data-id", t.id);
      editInput.maxLength = 300;
      editInput.value = t.text;
      editInput.addEventListener("keydown", function(e){
        if (e.key === "Enter"){ e.preventDefault(); commitEdit(t.id, editInput.value); }
        else if (e.key === "Escape"){ e.preventDefault(); cancelEdit(); }
      });
      editInput.addEventListener("blur", function(){
        // let a Cancel-button click register before we commit on blur
        setTimeout(function(){ if (editingTaskId === t.id) commitEdit(t.id, editInput.value); }, 120);
      });
      body.appendChild(editInput);
    } else {
      var textEl = document.createElement("div");
      textEl.className = "task-text";
      textEl.textContent = t.text;
      body.appendChild(textEl);
    }

    var meta = document.createElement("div");
    meta.className = "task-meta";
    if (priority === "high"){
      var bp = document.createElement("span");
      bp.className = "badge pri-high";
      bp.textContent = "High";
      meta.appendChild(bp);
    } else if (priority === "low"){
      var bpl = document.createElement("span");
      bpl.className = "badge pri-low";
      bpl.textContent = "Low";
      meta.appendChild(bpl);
    } else if (priority === "medium"){
      var bpm = document.createElement("span");
      bpm.className = "badge pri-medium";
      bpm.textContent = "Medium";
      meta.appendChild(bpm);
    }
    var due = dueInfo(t, opts.frozen ? opts.day : null);
    if (due){
      var bd = document.createElement("span");
      bd.className = "badge" + (due.cls ? " " + due.cls : "");
      bd.textContent = due.label;
      meta.appendChild(bd);
    }
    if (!opts.frozen && isSnoozed(t)){
      var bz = document.createElement("span");
      bz.className = "badge snoozed";
      bz.textContent = "snoozed · back " + fmtDay(t.snoozedUntil);
      meta.appendChild(bz);
    }
    if (t.repeat){
      var br = document.createElement("span");
      br.className = "badge repeat";
      br.textContent = "↻ " + t.repeat;
      meta.appendChild(br);
    }
    if (carried){
      var n = daysBetween(t.createdDate, TODAY);
      var b = document.createElement("span");
      b.className = "badge carry";
      b.textContent = "since " + fmtShort(t.createdDate) + " · " + n + "d";
      meta.appendChild(b);
    } else if (opts.frozen && t.createdDate !== opts.day){
      var b2 = document.createElement("span");
      b2.className = "badge";
      b2.textContent = "added " + fmtShort(t.createdDate);
      meta.appendChild(b2);
    } else if (opts.showAdded && t.createdDate !== TODAY){
      var b2b = document.createElement("span");
      b2b.className = "badge";
      b2b.textContent = "added " + fmtShort(t.createdDate);
      meta.appendChild(b2b);
    }
    if (isDone && (t.doneDate === TODAY || (opts.frozen && t.doneDate === opts.day) || opts.showDoneDate)){
      var b3 = document.createElement("span");
      b3.className = "badge";
      b3.textContent = t.doneDate && t.doneDate !== TODAY ? ("done " + fmtShort(t.doneDate)) : "done";
      meta.appendChild(b3);
    }
    if (meta.childNodes.length) body.appendChild(meta);

    if (!opts.frozen && !isDone && scheduleEditId === t.id) body.appendChild(scheduleEditor(t));

    var hasComment = !!(t.comment && t.comment.trim());
    var commentOpen = !opts.frozen && openCommentId === t.id;
    if (commentOpen || hasComment){
      var commentWrap = document.createElement("div");
      commentWrap.className = "comment-wrap";
      if (commentOpen){
        var commentInput = document.createElement("textarea");
        commentInput.className = "comment-input";
        commentInput.setAttribute("data-id", t.id);
        commentInput.maxLength = 500;
        commentInput.placeholder = "Add a note…";
        commentInput.value = t.comment || "";
        // Saved on blur/close rather than per keystroke: a live save while typing
        // would re-render the list and rebuild this textarea mid-keystroke,
        // swallowing whatever key was pressed at that instant (typically the
        // space between words, since that's naturally where people pause).
        commentInput.addEventListener("blur", function(){
          // Fallback for focus changes the pointerdown listener can't see
          // (e.g. tabbing away by keyboard). Guarded so it doesn't fight
          // with a comment-btn click already handled by toggleComment().
          if (openCommentId !== t.id) return;
          updateTaskComment(t.id, commentInput.value);
          openCommentId = null;
          render();
        });
        commentInput.addEventListener("keydown", function(e){
          if (e.key === "Escape"){
            e.preventDefault();
            updateTaskComment(t.id, commentInput.value);
            openCommentId = null;
            render();
          }
        });
        commentWrap.appendChild(commentInput);
      } else {
        var commentText = document.createElement("div");
        commentText.className = "comment-text";
        commentText.textContent = t.comment;
        if (!opts.frozen){
          commentText.onclick = function(){ openComment(t.id); };
        }
        commentWrap.appendChild(commentText);
      }
      body.appendChild(commentWrap);
    }
    li.appendChild(body);

    if (!opts.frozen && isEditing){
      var editActions = document.createElement("div");
      editActions.className = "task-actions";
      var saveBtn = document.createElement("button");
      saveBtn.className = "icon-btn save"; saveBtn.title = "Save";
      saveBtn.innerHTML = checkSvg();
      // mousedown fires before the input's blur handler, so this registers first
      saveBtn.addEventListener("mousedown", function(e){ e.preventDefault(); commitEdit(t.id, editInput.value); });
      editActions.appendChild(saveBtn);
      var cancelBtn = document.createElement("button");
      cancelBtn.className = "icon-btn cancel"; cancelBtn.title = "Cancel";
      cancelBtn.innerHTML = closeSvg();
      cancelBtn.addEventListener("mousedown", function(e){ e.preventDefault(); cancelEdit(); });
      editActions.appendChild(cancelBtn);
      li.appendChild(editActions);
      return li;
    }

    if (!opts.frozen){
      var actions = document.createElement("div");
      actions.className = "task-actions";
      var editBtn = document.createElement("button");
      editBtn.className = "icon-btn"; editBtn.title = "Edit";
      editBtn.innerHTML = pencilSvg();
      editBtn.onclick = function(){ startEdit(t.id); };
      actions.appendChild(editBtn);
      var commentBtn = document.createElement("button");
      commentBtn.className = "icon-btn comment-btn" + (hasComment ? " has" : "");
      commentBtn.title = hasComment ? "Edit note" : "Add a note";
      commentBtn.innerHTML = commentSvg();
      // mousedown + preventDefault, same trick as the save/cancel buttons:
      // it stops the browser from blurring an open note box before this
      // handler runs, so toggleComment() always sees the real prior state
      // instead of racing a blur that already cleared it out from under it.
      commentBtn.addEventListener("mousedown", function(e){ e.preventDefault(); toggleComment(t.id); });
      actions.appendChild(commentBtn);
      if (!isDone){
        var dueBtn = document.createElement("button");
        dueBtn.className = "icon-btn due-btn" + (t.dueDate || isSnoozed(t) || t.repeat ? " has" : "");
        dueBtn.title = "Due date, snooze, repeat";
        dueBtn.setAttribute("aria-label", "Due date, snooze, repeat");
        dueBtn.innerHTML = calendarSvg();
        dueBtn.addEventListener("mousedown", function(e){ e.preventDefault(); toggleScheduleEdit(t.id); });
        actions.appendChild(dueBtn);
      }
      var priBtn = document.createElement("button");
      priBtn.className = "pri-cycle";
      priBtn.setAttribute("data-pri", priority);
      priBtn.title = "Priority: " + PRIORITY_LABEL[priority] + " (click to choose)";
      priBtn.innerHTML = '<span class="pri-dot"></span>';
      priBtn.addEventListener("mousedown", function(e){
        e.preventDefault();
        if (priorityMenuTarget && priorityMenuTarget.kind === "task" && priorityMenuTarget.id === t.id){ closePriorityMenu(); }
        else { openPriorityMenu("task", t.id, priBtn); }
      });
      actions.appendChild(priBtn);
      if (isDone){
        var undoBtn = document.createElement("button");
        undoBtn.className = "icon-btn"; undoBtn.title = "Reopen"; undoBtn.innerHTML = undoSvg();
        undoBtn.onclick = function(){ reopenTask(t.id); };
        actions.appendChild(undoBtn);
      }
      var delBtn = document.createElement("button");
      delBtn.className = "icon-btn"; delBtn.title = "Delete"; delBtn.innerHTML = trashSvg();
      delBtn.onclick = function(){
        openConfirm({
          title: "Delete this task?",
          message: '"' + t.text + '" will be removed for good. This can\'t be undone.',
          confirmLabel: "Yes, delete",
          onConfirm: function(){ deleteTask(t.id); }
        });
      };
      actions.appendChild(delBtn);
      li.appendChild(actions);
    }

    return li;
  }

  function emptyState(msg1, msg2){
    var wrap = document.createElement("div");
    wrap.className = "empty";
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M8 12l2.5 2.5L16 9"/></svg>' +
      "<b>" + msg1 + "</b><span>" + msg2 + "</span>";
    return wrap;
  }

  function commitNewBoard(value){
    var name = (value || "").trim();
    boardFormOpen = false;
    if (name) createBoard(name); else render();
  }

  function renderBoardSwitch(){
    var wrap = document.getElementById("boardSwitch");
    wrap.innerHTML = "";
    boards.forEach(function(b){
      if (renamingBoardId === b.id){
        var renameInput = document.createElement("input");
        renameInput.type = "text";
        renameInput.className = "board-rename-input";
        renameInput.maxLength = 40;
        renameInput.value = b.name;
        renameInput.addEventListener("keydown", function(e){
          if (e.key === "Enter"){ e.preventDefault(); commitRename(b.id, renameInput.value); }
          else if (e.key === "Escape"){ e.preventDefault(); renamingBoardId = null; render(); }
        });
        renameInput.addEventListener("blur", function(){
          setTimeout(function(){ if (renamingBoardId === b.id) commitRename(b.id, renameInput.value); }, 120);
        });
        wrap.appendChild(renameInput);
        setTimeout(function(){ renameInput.focus(); renameInput.select(); }, 0);
        return;
      }

      var chip = document.createElement("div");
      chip.className = "board-tab" + (b.id === currentBoard ? " active" : "");

      var mainBtn = document.createElement("button");
      mainBtn.className = "board-tab-main";
      mainBtn.title = b.name;
      var dot = document.createElement("span");
      dot.className = "board-dot";
      dot.style.background = boardColor(b.id);
      mainBtn.appendChild(dot);
      var nameEl = document.createElement("span");
      nameEl.className = "board-name";
      nameEl.textContent = b.name;
      mainBtn.appendChild(nameEl);
      var countEl = document.createElement("span");
      countEl.className = "count";
      countEl.textContent = String(openCountForBoard(b.id));
      mainBtn.appendChild(countEl);
      mainBtn.onclick = function(){ switchBoard(b.id); };
      chip.appendChild(mainBtn);

      if (b.id === currentBoard){
        var renameBtn = document.createElement("button");
        renameBtn.className = "board-rename-btn";
        renameBtn.title = "Rename board";
        renameBtn.setAttribute("aria-label", "Rename board");
        renameBtn.innerHTML = pencilSvg();
        renameBtn.onclick = function(){ renamingBoardId = b.id; render(); };
        chip.appendChild(renameBtn);

        var deleteBoardBtn = document.createElement("button");
        deleteBoardBtn.className = "board-delete-btn";
        deleteBoardBtn.title = "Delete board and its tasks";
        deleteBoardBtn.setAttribute("aria-label", "Delete board");
        deleteBoardBtn.innerHTML = trashSvg();
        deleteBoardBtn.onclick = function(){
          openConfirm({
            title: 'Delete "' + b.name + '"?',
            message: "This deletes the board along with every task and review note filed under it. This can't be undone.",
            confirmLabel: "Yes, delete",
            onConfirm: function(){ deleteBoard(b.id); }
          });
        };
        chip.appendChild(deleteBoardBtn);
      }

      wrap.appendChild(chip);
    });

    if (boardFormOpen){
      var boardInput = document.createElement("input");
      boardInput.type = "text";
      boardInput.className = "board-new-input";
      boardInput.placeholder = "Board name";
      boardInput.maxLength = 40;
      boardInput.addEventListener("keydown", function(e){
        if (e.key === "Enter"){ e.preventDefault(); commitNewBoard(boardInput.value); }
        else if (e.key === "Escape"){ e.preventDefault(); boardFormOpen = false; render(); }
      });
      boardInput.addEventListener("blur", function(){
        setTimeout(function(){ if (boardFormOpen) commitNewBoard(boardInput.value); }, 120);
      });
      wrap.appendChild(boardInput);
      setTimeout(function(){ boardInput.focus(); }, 0);
    } else {
      var addBtn = document.createElement("button");
      addBtn.className = "board-add-btn";
      addBtn.title = "New board";
      addBtn.setAttribute("aria-label", "New board");
      addBtn.innerHTML = plusSvg();
      addBtn.onclick = function(){ boardFormOpen = true; render(); };
      wrap.appendChild(addBtn);
    }
  }

  function renderStats(){
    document.getElementById("statOpen").textContent = openTasksSorted().length;
    document.getElementById("statDoneToday").textContent = doneTodaySorted().length;
    document.getElementById("statCarried").textContent = openTasksSorted().filter(function(t){ return t.createdDate < TODAY; }).length;
    document.getElementById("statDue").textContent = openTasksSorted().filter(isDueNow).length;
  }

  function renderStrip(){
    var strip = document.getElementById("dayStrip");
    strip.innerHTML = "";
    // Fixed Monday–Sunday calendar row (like a week-view calendar), not a
    // rolling window — today sits in its real weekday column instead of
    // always being last.
    var weekStart = weekStartOf(TODAY);
    // The highlighted dot follows whichever day is currently in focus: Today
    // by default (and whenever the Today tab is open), or whichever day
    // History is browsing to while the History tab is open.
    var highlightDay = activeTab === "history" ? (histDateInput.value || histMaxDay) : TODAY;
    for (var i = 0; i <= 6; i++){
      (function(dateStr){
        var isFuture = dateStr > TODAY;
        var isToday = dateStr === TODAY;
        var isSelected = dateStr === highlightDay;
        var btn = document.createElement("button");
        btn.className = "day-dot" + (isSelected ? " is-selected" : "") + (isFuture ? " is-future" : "");
        var d = new Date(dateStr + "T00:00:00");
        var lbl = isToday ? "Today" : WEEKDAY[d.getDay()];
        var dotClass = isFuture || !dayHasAny(dateStr) ? "" : (dayHasOpenAt(dateStr) ? "pending" : "clear");
        btn.innerHTML = '<span class="lbl">' + lbl + '</span><span class="dot ' + dotClass + '"></span>';
        if (isFuture){
          btn.disabled = true;
        } else if (isToday){
          // Today's tasks live on the Today tab, not History — jump there
          // instead of opening a History entry for today.
          btn.onclick = function(){ switchTab("today"); };
        } else {
          btn.onclick = function(){
            histDateInput.value = dateStr;
            switchTab("history"); // also re-renders the strip with the new highlight
            renderHistory();
          };
        }
        strip.appendChild(btn);
      })(dayOffset(weekStart, i));
    }
  }

  var snoozedOpen = false; // the Today tab's "Snoozed & upcoming" section starts collapsed
  function renderToday(){
    var openGroup = document.getElementById("todayOpenGroup");
    var doneGroup = document.getElementById("todayDoneGroup");
    openGroup.innerHTML = "";
    doneGroup.innerHTML = "";

    var open = openTasksSorted();
    var snoozed = snoozedTasksSorted();
    if (!open.length && !doneTodaySorted().length && !snoozed.length){
      openGroup.appendChild(emptyState("Nothing on the list", "Add what you want to get done today in the box above."));
      return;
    }

    if (open.length){
      var lblRow = document.createElement("div");
      lblRow.className = "group-label-row";
      var lbl = document.createElement("div");
      lbl.className = "group-label";
      var actions = document.createElement("div");
      actions.className = "group-actions";

      if (selectMode){
        var n = selectedCount();
        lbl.textContent = n ? (n + " selected") : "Select tasks to move";
        lblRow.appendChild(lbl);

        var moveBtn = document.createElement("button");
        moveBtn.type = "button";
        moveBtn.className = "move-trigger";
        moveBtn.textContent = "Move to board" + (n ? " (" + n + ")" : "");
        moveBtn.disabled = !n;
        moveBtn.addEventListener("mousedown", function(e){
          e.preventDefault();
          if (boardMoveMenuTarget){ closeBoardMoveMenu(); } else { openBoardMoveMenu(moveBtn); }
        });
        actions.appendChild(moveBtn);

        var cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "reset-sort-link";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = function(){ toggleSelectMode(); };
        actions.appendChild(cancelBtn);
      } else {
        lbl.textContent = "Open — " + open.length;
        lblRow.appendChild(lbl);

        if (isManualOrder()){
          var resetBtn = document.createElement("button");
          resetBtn.type = "button";
          resetBtn.className = "reset-sort-link";
          resetBtn.textContent = "Reset to priority sort";
          resetBtn.onclick = function(){ resetManualOrder(); };
          actions.appendChild(resetBtn);
        }
        // Bulk-move only makes sense when there's at least one other board
        // to move tasks to.
        if (boards.length > 1){
          var selectToggleBtn = document.createElement("button");
          selectToggleBtn.type = "button";
          selectToggleBtn.className = "reset-sort-link";
          selectToggleBtn.textContent = "Select";
          selectToggleBtn.onclick = function(){ toggleSelectMode(); };
          actions.appendChild(selectToggleBtn);
        }
      }

      lblRow.appendChild(actions);
      openGroup.appendChild(lblRow);
      var ul = document.createElement("ul");
      ul.className = "tasklist";
      open.forEach(function(t){ ul.appendChild(taskRow(t, selectMode ? { selectable: true } : { reorderable: true })); });
      openGroup.appendChild(ul);
    } else {
      openGroup.appendChild(emptyState("All clear for today", "Nothing open — nice work. Add a new task whenever."));
    }

    // Snoozed (and upcoming repeats) — tucked away, but always one click from view.
    if (snoozed.length){
      var snzBtn = document.createElement("button");
      snzBtn.type = "button";
      snzBtn.className = "group-label snooze-toggle";
      snzBtn.setAttribute("aria-expanded", snoozedOpen ? "true" : "false");
      snzBtn.textContent = (snoozedOpen ? "▾ " : "▸ ") + "Snoozed & upcoming — " + snoozed.length;
      snzBtn.onclick = function(){ snoozedOpen = !snoozedOpen; renderToday(); };
      openGroup.appendChild(snzBtn);
      if (snoozedOpen){
        var ulz = document.createElement("ul");
        ulz.className = "tasklist snoozed-list";
        snoozed.forEach(function(t){ ulz.appendChild(taskRow(t)); });
        openGroup.appendChild(ulz);
      }
    }

    var done = doneTodaySorted();
    if (done.length){
      var lbl2 = document.createElement("div");
      lbl2.className = "group-label";
      lbl2.textContent = "Completed today — " + done.length;
      doneGroup.appendChild(lbl2);
      var ul2 = document.createElement("ul");
      ul2.className = "tasklist";
      done.forEach(function(t){ ul2.appendChild(taskRow(t)); });
      doneGroup.appendChild(ul2);
    }
  }

  function renderHistory(){
    var day = histDateInput.value || histMaxDay;
    var group = document.getElementById("historyGroup");
    group.innerHTML = "";
    document.getElementById("histNext").disabled = day >= histMaxDay;

    var lbl = document.createElement("div");
    lbl.className = "group-label";
    lbl.textContent = fmtLong(day);
    group.appendChild(lbl);

    var onDay = tasksOnDay(day);
    if (!onDay.length){
      group.appendChild(emptyState("No record for this day", "Nothing was on the list, or it hadn't been added yet."));
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "tasklist";
    onDay.forEach(function(t){
      var frozenDone = t.doneDate === day;
      ul.appendChild(taskRow(t, { frozen: true, frozenDone: frozenDone, day: day }));
    });
    group.appendChild(ul);
  }

  function renderCompleted(){
    var group = document.getElementById("completedGroup");
    group.innerHTML = "";
    var done = allDoneTasksSorted();
    if (!done.length){
      group.appendChild(emptyState("Nothing completed yet", "Tasks you check off show up here, no matter when they were added or finished."));
      return;
    }
    var lbl = document.createElement("div");
    lbl.className = "group-label";
    lbl.textContent = "Completed — " + done.length;
    group.appendChild(lbl);
    var ul = document.createElement("ul");
    ul.className = "tasklist";
    done.forEach(function(t){ ul.appendChild(taskRow(t, { showDoneDate: true })); });
    group.appendChild(ul);
  }

  var reviewNotesEl = document.getElementById("reviewNotes");
  var reviewNotesBoundFor = null;
  function renderReview(){
    var start = reviewWeekStart;
    var end = dayOffset(start, 6);
    document.getElementById("reviewRangeLabel").textContent = fmtShort(start) + " – " + fmtShort(end);
    document.getElementById("reviewRangeSub").textContent = start === THIS_WEEK_START ? "This week" : (fmtLong(start).split(",")[0] + " start");
    document.getElementById("reviewNext").disabled = start >= THIS_WEEK_START;

    var done = tasksDoneInWeek(start);
    var stillOpen = tasksStillOpenFromWeek(start);
    var highDone = done.filter(function(t){ return normalizePriority(t.priority) === "high"; }).length;
    var highOpen = stillOpen.filter(function(t){ return normalizePriority(t.priority) === "high"; }).length;
    document.getElementById("statWeekDone").textContent = done.length;
    document.getElementById("statWeekOpen").textContent = stillOpen.length;
    var doneHighBadge = document.getElementById("statWeekDoneHigh");
    doneHighBadge.textContent = highDone + " high";
    doneHighBadge.style.display = highDone ? "" : "none";
    var openHighBadge = document.getElementById("statWeekOpenHigh");
    openHighBadge.textContent = highOpen + " high";
    openHighBadge.style.display = highOpen ? "" : "none";

    var openGroup = document.getElementById("reviewOpenGroup");
    var doneGroup = document.getElementById("reviewDoneGroup");
    openGroup.innerHTML = "";
    doneGroup.innerHTML = "";

    if (stillOpen.length){
      var lbl = document.createElement("div");
      lbl.className = "group-label";
      lbl.textContent = "Still open — " + stillOpen.length;
      openGroup.appendChild(lbl);
      var ul = document.createElement("ul");
      ul.className = "tasklist";
      stillOpen.forEach(function(t){ ul.appendChild(taskRow(t, { showAdded: true })); });
      openGroup.appendChild(ul);
    }

    if (done.length){
      var lbl2 = document.createElement("div");
      lbl2.className = "group-label";
      lbl2.textContent = "Completed — " + done.length;
      doneGroup.appendChild(lbl2);
      var ul2 = document.createElement("ul");
      ul2.className = "tasklist";
      done.forEach(function(t){ ul2.appendChild(taskRow(t, { showDoneDate: true })); });
      doneGroup.appendChild(ul2);
    }

    if (!stillOpen.length && !done.length){
      openGroup.appendChild(emptyState("Nothing recorded", "No tasks were created or completed this week yet."));
    }

    var rec = reviewFor(start);
    var boundKey = reviewDocId(start);
    if (reviewNotesBoundFor !== boundKey){
      reviewNotesEl.value = rec.notes || "";
      reviewNotesBoundFor = boundKey;
    }
    var markBtn = document.getElementById("reviewMarkBtn");
    if (rec.reviewedAt){
      var d = new Date(rec.reviewedAt);
      markBtn.className = "review-mark done";
      markBtn.innerHTML = checkSvg() + "<span>Reviewed " + fmtShort(toLocalStr(d)) + " — click to unmark</span>";
    } else {
      markBtn.className = "review-mark";
      markBtn.innerHTML = flagSvg() + "<span>Mark this week reviewed</span>";
    }
  }

  reviewNotesEl.addEventListener("input", function(){
    var start = reviewWeekStart;
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(function(){ saveReviewNotes(start, reviewNotesEl.value); }, 500);
  });
  document.getElementById("reviewMarkBtn").addEventListener("click", function(){
    toggleReviewed(reviewWeekStart);
  });
  document.getElementById("reviewPrev").addEventListener("click", function(){
    reviewWeekStart = dayOffset(reviewWeekStart, -7);
    reviewNotesBoundFor = null;
    renderReview();
  });
  document.getElementById("reviewNext").addEventListener("click", function(){
    var next = dayOffset(reviewWeekStart, 7);
    if (next <= THIS_WEEK_START){ reviewWeekStart = next; reviewNotesBoundFor = null; renderReview(); }
  });

  var monthReviewNotesEl = document.getElementById("monthReviewNotes");
  var monthReviewNotesBoundFor = null;
  var monthReviewSelectedDay = null; // date string, or null — which calendar cell's tasks show below

  // Builds the month's calendar grid: one cell per day, plus leading blank
  // cells so day 1 lands under the right weekday column. Each cell shows a
  // compact "N completed" / "N still open" chip pair (done placed by
  // doneDate, open placed by createdDate — matching the stats above) and a
  // small dot when the day includes a high-priority task either way.
  function buildMonthCalendar(monthStart, done, stillOpen){
    var end = monthEndOf(monthStart);
    var doneByDay = {}, openByDay = {}, highByDay = {};
    done.forEach(function(t){
      doneByDay[t.doneDate] = (doneByDay[t.doneDate] || 0) + 1;
      if (normalizePriority(t.priority) === "high") highByDay[t.doneDate] = true;
    });
    stillOpen.forEach(function(t){
      openByDay[t.createdDate] = (openByDay[t.createdDate] || 0) + 1;
      if (normalizePriority(t.priority) === "high") highByDay[t.createdDate] = true;
    });

    var grid = document.getElementById("monthReviewCalGrid");
    grid.innerHTML = "";
    var firstDow = new Date(monthStart + "T00:00:00").getDay(); // 0=Sun..6=Sat
    for (var i = 0; i < firstDow; i++){
      var pad = document.createElement("span");
      pad.className = "cal-cell cal-empty";
      pad.setAttribute("aria-hidden", "true");
      grid.appendChild(pad);
    }
    var d = monthStart;
    while (d <= end){
      grid.appendChild(buildCalCell(d, doneByDay[d] || 0, openByDay[d] || 0, !!highByDay[d]));
      d = dayOffset(d, 1);
    }
  }

  function buildCalCell(dateStr, doneCount, openCount, hasHigh){
    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell" +
      (dateStr === TODAY ? " cal-today" : "") +
      (dateStr === monthReviewSelectedDay ? " cal-selected" : "");
    cell.setAttribute("data-date", dateStr);
    var dayNum = new Date(dateStr + "T00:00:00").getDate();
    var parts = [];
    if (doneCount) parts.push(doneCount + " completed");
    if (openCount) parts.push(openCount + " still open");
    if (hasHigh) parts.push("includes a high priority task");
    cell.setAttribute("aria-label", fmtLong(dateStr) + (parts.length ? ": " + parts.join(", ") : ": nothing recorded"));
    cell.title = fmtShort(dateStr);

    var num = document.createElement("span");
    num.className = "cal-daynum";
    num.textContent = dayNum;
    cell.appendChild(num);

    if (hasHigh){
      var hd = document.createElement("span");
      hd.className = "cal-high-dot";
      hd.title = "Includes a high priority task";
      cell.appendChild(hd);
    }

    if (doneCount || openCount){
      var counts = document.createElement("span");
      counts.className = "cal-counts";
      if (doneCount){
        var cd = document.createElement("span");
        cd.className = "cal-count done";
        cd.textContent = doneCount;
        cd.title = doneCount + " completed";
        counts.appendChild(cd);
      }
      if (openCount){
        var co = document.createElement("span");
        co.className = "cal-count open";
        co.textContent = openCount;
        co.title = openCount + " still open";
        counts.appendChild(co);
      }
      cell.appendChild(counts);
    }

    cell.addEventListener("click", function(){
      monthReviewSelectedDay = dateStr;
      renderMonthReview();
    });

    return cell;
  }

  // The panel below the calendar that fills in with a tapped day's actual
  // tasks — open ones placed here by createdDate, done ones by doneDate,
  // rendered with the same taskRow() used everywhere else so edit/comment/
  // priority/delete all still work normally (these aren't frozen snapshots).
  function renderMonthReviewDayDetail(done, stillOpen){
    var wrap = document.getElementById("monthReviewDayDetail");
    wrap.innerHTML = "";
    if (!monthReviewSelectedDay){
      wrap.appendChild(emptyState("Tap a day on the calendar", "See what was completed or added that day."));
      return;
    }
    var day = monthReviewSelectedDay;
    var dayOpen = stillOpen.filter(function(t){ return t.createdDate === day; });
    var dayDone = done.filter(function(t){ return t.doneDate === day; });
    var total = dayOpen.length + dayDone.length;

    var lbl = document.createElement("div");
    lbl.className = "group-label";
    lbl.textContent = fmtLong(day) + " — " + total + (total === 1 ? " task" : " tasks");
    wrap.appendChild(lbl);

    if (!total){
      wrap.appendChild(emptyState("Nothing recorded", "No tasks were created or completed on " + fmtShort(day) + "."));
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "tasklist";
    dayOpen.forEach(function(t){ ul.appendChild(taskRow(t, {})); });
    dayDone.forEach(function(t){ ul.appendChild(taskRow(t, {})); });
    wrap.appendChild(ul);
  }

  function renderMonthReview(){
    var start = reviewMonthStart;
    document.getElementById("monthReviewRangeLabel").textContent = fmtMonthLabel(start);
    document.getElementById("monthReviewRangeSub").textContent = start === THIS_MONTH_START ? "This month" : "";
    document.getElementById("monthReviewNext").disabled = start >= THIS_MONTH_START;

    var done = tasksDoneInMonth(start);
    var stillOpen = tasksStillOpenFromMonth(start);
    var highDone = done.filter(function(t){ return normalizePriority(t.priority) === "high"; }).length;
    var highOpen = stillOpen.filter(function(t){ return normalizePriority(t.priority) === "high"; }).length;
    document.getElementById("statMonthDone").textContent = done.length;
    document.getElementById("statMonthOpen").textContent = stillOpen.length;
    var monthDoneHighBadge = document.getElementById("statMonthDoneHigh");
    monthDoneHighBadge.textContent = highDone + " high";
    monthDoneHighBadge.style.display = highDone ? "" : "none";
    var monthOpenHighBadge = document.getElementById("statMonthOpenHigh");
    monthOpenHighBadge.textContent = highOpen + " high";
    monthOpenHighBadge.style.display = highOpen ? "" : "none";

    buildMonthCalendar(start, done, stillOpen);
    renderMonthReviewDayDetail(done, stillOpen);

    var rec = monthReviewFor(start);
    var boundKey = monthReviewDocId(start);
    if (monthReviewNotesBoundFor !== boundKey){
      monthReviewNotesEl.value = rec.notes || "";
      monthReviewNotesBoundFor = boundKey;
    }
    var markBtn = document.getElementById("monthReviewMarkBtn");
    if (rec.reviewedAt){
      var d = new Date(rec.reviewedAt);
      markBtn.className = "review-mark done";
      markBtn.innerHTML = checkSvg() + "<span>Reviewed " + fmtShort(toLocalStr(d)) + " — click to unmark</span>";
    } else {
      markBtn.className = "review-mark";
      markBtn.innerHTML = flagSvg() + "<span>Mark this month reviewed</span>";
    }
  }

  monthReviewNotesEl.addEventListener("input", function(){
    var start = reviewMonthStart;
    clearTimeout(monthNotesSaveTimer);
    monthNotesSaveTimer = setTimeout(function(){ saveMonthReviewNotes(start, monthReviewNotesEl.value); }, 500);
  });
  document.getElementById("monthReviewMarkBtn").addEventListener("click", function(){
    toggleMonthReviewed(reviewMonthStart);
  });
  document.getElementById("monthReviewPrev").addEventListener("click", function(){
    reviewMonthStart = prevMonthStart(reviewMonthStart);
    monthReviewNotesBoundFor = null;
    monthReviewSelectedDay = null;
    renderMonthReview();
  });
  document.getElementById("monthReviewNext").addEventListener("click", function(){
    var next = nextMonthStart(reviewMonthStart);
    if (next <= THIS_MONTH_START){ reviewMonthStart = next; monthReviewNotesBoundFor = null; monthReviewSelectedDay = null; renderMonthReview(); }
  });

  // Clicking the "completed" stat tile on a review tab jumps straight down
  // to that tab's completed-tasks section, instead of making people scroll
  // past the still-open list to find it.
  function scrollToSection(id){
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function wireStatJump(tileId, targetId){
    var tile = document.getElementById(tileId);
    if (!tile) return;
    tile.addEventListener("click", function(){ scrollToSection(targetId); });
    tile.addEventListener("keydown", function(e){
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); scrollToSection(targetId); }
    });
  }
  wireStatJump("statWeekDoneTile", "reviewDoneGroup");
  wireStatJump("statMonthDoneTile", "monthReviewCalGrid");

  // ---------- tabs ----------
  function switchTab(name){
    activeTab = name;
    document.getElementById("tabToday").classList.toggle("active", name === "today");
    document.getElementById("tabHistory").classList.toggle("active", name === "history");
    document.getElementById("tabCompleted").classList.toggle("active", name === "completed");
    document.getElementById("tabReview").classList.toggle("active", name === "review");
    document.getElementById("tabMonthReview").classList.toggle("active", name === "monthReview");
    document.getElementById("paneToday").style.display = name === "today" ? "" : "none";
    document.getElementById("paneHistory").style.display = name === "history" ? "" : "none";
    document.getElementById("paneCompleted").style.display = name === "completed" ? "" : "none";
    document.getElementById("paneReview").style.display = name === "review" ? "" : "none";
    document.getElementById("paneMonthReview").style.display = name === "monthReview" ? "" : "none";
    // Keep the day-strip's highlighted dot in sync with whichever day is
    // now in focus (Today, or whatever day History is showing).
    renderStrip();
  }
  document.getElementById("tabToday").onclick = function(){ switchTab("today"); };
  document.getElementById("tabHistory").onclick = function(){ switchTab("history"); };
  document.getElementById("tabCompleted").onclick = function(){ switchTab("completed"); };
  document.getElementById("tabReview").onclick = function(){ switchTab("review"); };
  document.getElementById("tabMonthReview").onclick = function(){ switchTab("monthReview"); };

  // ---------- composer ----------
  var input = document.getElementById("newTaskInput");
  var addBtn = document.getElementById("addBtn");
  function syncAddBtn(){ addBtn.disabled = !input.value.trim(); }
  input.addEventListener("input", syncAddBtn);
  input.addEventListener("keydown", function(e){
    if (e.key === "Enter" && input.value.trim()){ submitNew(); }
  });
  addBtn.addEventListener("click", submitNew);
  function submitNew(){
    var v = input.value;
    input.value = "";
    syncAddBtn();
    addTask(v);
  }
  syncAddBtn();

  // ---------- history date controls ----------
  histDateInput.addEventListener("change", function(){
    if (histDateInput.value > histMaxDay) histDateInput.value = histMaxDay;
    renderStrip();
    renderHistory();
  });
  document.getElementById("histPrev").addEventListener("click", function(){
    histDateInput.value = dayOffset(histDateInput.value || histMaxDay, -1);
    renderStrip(); renderHistory();
  });
  document.getElementById("histNext").addEventListener("click", function(){
    var next = dayOffset(histDateInput.value || histMaxDay, 1);
    if (next <= histMaxDay){ histDateInput.value = next; renderStrip(); renderHistory(); }
  });

  // ---------- boot ----------
  // Data comes from the Task Organizer API (public/api-store.js); every
  // signed-in person only ever sees their own boards, tasks and reviews.

  // ---------- day rollover ----------
  // TODAY is computed once at load. If the page/tab is left open across
  // midnight it would otherwise go stale until a manual reload. This
  // detects the calendar date changing while the app is open — on the tab
  // regaining focus/visibility (the common "closed laptop overnight, opened
  // it this morning" case), plus a periodic safety-net timer for a tab left
  // visible straight through midnight — and refreshes all today-relative
  // state, jumping back to the Today tab so the app always opens on today.
  function refreshForNewDay(){
    var now = todayStr();
    if (now === TODAY) return;

    // Flush any in-progress edit before state shifts out from under it,
    // same pattern used when switching boards.
    commitOpenComment();
    if (editingTaskId){
      var editEl = document.querySelector('.edit-input[data-id="' + editingTaskId + '"]');
      if (editEl) commitEdit(editingTaskId, editEl.value);
    }
    if (renamingBoardId){
      var renameEl = document.querySelector(".board-rename-input");
      if (renameEl) commitRename(renamingBoardId, renameEl.value);
    }
    if (boardFormOpen){
      var boardEl = document.querySelector(".board-new-input");
      if (boardEl) commitNewBoard(boardEl.value);
    }
    closeConfirm();
    priorityMenuTarget = null;
    scheduleEditId = null;
    selectMode = false;
    selectedTaskIds = {};
    boardMoveMenuTarget = null;

    TODAY = now;
    document.getElementById("todayLabel").textContent = fmtLong(TODAY);
    histMaxDay = dayOffset(TODAY, -1);
    histDateInput.max = histMaxDay;
    histDateInput.value = histMaxDay;
    THIS_WEEK_START = weekStartOf(TODAY);
    reviewWeekStart = THIS_WEEK_START;
    reviewNotesBoundFor = null;
    THIS_MONTH_START = monthStartOf(TODAY);
    reviewMonthStart = THIS_MONTH_START;
    monthReviewNotesBoundFor = null;
    monthReviewSelectedDay = null;
    switchTab("today");
    render();
  }
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "visible") refreshForNewDay();
  });
  window.addEventListener("focus", refreshForNewDay);
  setInterval(refreshForNewDay, 5 * 60 * 1000);

  // ---------- signed-in user + server errors ----------
  var SERVER_ERROR_MSG = "Couldn't reach the server — your last change may not be saved. Try reloading.";
  window.addEventListener("taskapi:error", function(){ setBanner(SERVER_ERROR_MSG); });
  function renderUser(me){
    document.getElementById("userName").textContent = me.name || me.email;
    document.getElementById("userChip").hidden = false;
  }
  document.getElementById("signOutBtn").addEventListener("click", async function(){
    try { await window.TaskApi.logout(); } catch(e){}
    // Clear anything this app wrote to the browser before leaving.
    ["rollover_board_v1", "rollover_tasks_v1", "rollover_reviews_v1", "rollover_boards_v1"].forEach(function(k){
      try { localStorage.removeItem(k); } catch(e){}
    });
    window.location.href = "/login";
  });

  // ---------- Claude assistant ----------
  // "Plan my day" asks the server (which asks Claude) what to tackle first on
  // this board; "Notes → tasks" turns pasted notes into draft tasks the person
  // reviews before anything is added. Everything Claude returns is shown as
  // plain text (textContent), never as HTML.
  var AI_ERRORS = {
    daily_limit: "You've reached today's limit for Claude requests. Try again tomorrow.",
    rate_limited: "That's a lot of requests at once. Wait a minute and try again.",
    refused: "Claude couldn't help with that one. Try rewording it.",
    invalid_input: "That input wasn't accepted. Notes can be up to 6,000 characters.",
    ai_disabled: "Claude features are turned off on this server."
  };
  function aiErrorText(code){ return AI_ERRORS[code] || "Claude isn't available right now. Please try again."; }
  var aiCard = document.getElementById("aiCard");
  var aiPlanBtn = document.getElementById("aiPlanBtn");
  var aiNotesBtn = document.getElementById("aiNotesBtn");
  var aiPlanPanel = document.getElementById("aiPlanPanel");
  var aiNotesPanel = document.getElementById("aiNotesPanel");
  var aiNotesInput = document.getElementById("aiNotesInput");
  var aiDraftBtn = document.getElementById("aiDraftBtn");
  var aiDraftsEl = document.getElementById("aiDrafts");

  function el(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function priorityBadge(p){
    return el("span", "badge pri-" + p, PRIORITY_LABEL[p] || "Low");
  }

  async function initAssistant(){
    aiCard.hidden = false;
    var status = await window.TaskApi.aiStatus();
    if (!status.enabled){
      aiPlanBtn.disabled = true;
      aiNotesBtn.disabled = true;
      document.getElementById("aiOff").hidden = false;
    }
  }

  aiPlanBtn.addEventListener("click", async function(){
    if (!currentBoard) return;
    aiNotesPanel.hidden = true;
    aiPlanPanel.hidden = false;
    aiPlanPanel.innerHTML = "";
    aiPlanPanel.appendChild(el("p", "ai-status", "Claude is looking at your list…"));
    aiPlanBtn.disabled = true;
    var boardAtStart = currentBoard;
    var out = await window.TaskApi.ai("plan", { board: boardAtStart, today: TODAY });
    aiPlanBtn.disabled = false;
    aiPlanPanel.innerHTML = "";
    if (out.error){ aiPlanPanel.appendChild(el("p", "ai-error", aiErrorText(out.error))); return; }
    aiPlanPanel.appendChild(el("p", "ai-summary", out.summary));
    var items = (out.focus || []).filter(function(f){ return tasks.some(function(t){ return t.id === f.taskId; }); });
    if (items.length){
      var ol = el("ol", "ai-focus");
      items.forEach(function(f){
        var t = tasks.find(function(x){ return x.id === f.taskId; });
        var li = el("li", "", t.text);
        li.appendChild(el("span", "ai-reason", f.reason));
        ol.appendChild(li);
      });
      aiPlanPanel.appendChild(ol);
    }
    var row = el("div", "ai-row");
    row.appendChild(el("p", "ai-note", "Suggestions from Claude. Double-check anything important."));
    var close = el("button", "ai-link", "Close");
    close.type = "button";
    close.onclick = function(){ aiPlanPanel.hidden = true; };
    row.appendChild(close);
    aiPlanPanel.appendChild(row);
  });

  aiNotesBtn.addEventListener("click", function(){
    aiPlanPanel.hidden = true;
    aiNotesPanel.hidden = !aiNotesPanel.hidden;
    if (!aiNotesPanel.hidden) aiNotesInput.focus();
  });
  document.getElementById("aiNotesClose").addEventListener("click", function(){
    aiNotesPanel.hidden = true;
  });

  aiDraftBtn.addEventListener("click", async function(){
    var notes = aiNotesInput.value.trim();
    if (!notes) return;
    aiDraftsEl.innerHTML = "";
    aiDraftsEl.appendChild(el("p", "ai-status", "Claude is drafting tasks…"));
    aiDraftBtn.disabled = true;
    var out = await window.TaskApi.ai("extract", { notes: notes, today: TODAY });
    aiDraftBtn.disabled = false;
    aiDraftsEl.innerHTML = "";
    if (out.error){ aiDraftsEl.appendChild(el("p", "ai-error", aiErrorText(out.error))); return; }
    var drafts = out.tasks || [];
    if (!drafts.length){ aiDraftsEl.appendChild(el("p", "ai-status", "No action items found in those notes.")); return; }
    renderDrafts(drafts);
  });

  function renderDrafts(drafts){
    var ul = el("ul", "ai-drafts");
    var boxes = [];
    drafts.forEach(function(d){
      var li = el("li", "ai-draft");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.setAttribute("aria-label", "Add this task");
      boxes.push(box);
      li.appendChild(box);
      var body = el("div", "ai-draft-body");
      body.appendChild(el("span", "ai-draft-text", d.text));
      var meta = el("div", "task-meta");
      meta.appendChild(priorityBadge(d.priority));
      var due = dueInfo({ status: "open", dueDate: d.dueDate });
      if (due) meta.appendChild(el("span", "badge" + (due.cls ? " " + due.cls : ""), due.label));
      body.appendChild(meta);
      li.appendChild(body);
      ul.appendChild(li);
    });
    aiDraftsEl.appendChild(ul);
    var row = el("div", "ai-row");
    var addBtn = el("button", "ai-btn primary");
    addBtn.type = "button";
    function syncCount(){
      var n = boxes.filter(function(b){ return b.checked; }).length;
      addBtn.textContent = "Add " + n + (n === 1 ? " task" : " tasks");
      addBtn.disabled = !n;
    }
    boxes.forEach(function(b){ b.addEventListener("change", syncCount); });
    syncCount();
    addBtn.onclick = async function(){
      if (!currentBoard) return;
      addBtn.disabled = true;
      var chosen = drafts.filter(function(d, i){ return boxes[i].checked; });
      // Added one at a time through the normal task API, which validates
      // each one exactly like a hand-typed task.
      for (var i = 0; i < chosen.length; i++){
        var d = chosen[i];
        try {
          await col.add({ text: d.text, status: "open", priority: d.priority, comment: "", board: currentBoard, createdDate: TODAY, doneDate: null, dueDate: d.dueDate, createdAt: Date.now() });
        } catch(e){ /* the banner already explains it; keep going with the rest */ }
      }
      aiNotesInput.value = "";
      aiDraftsEl.innerHTML = "";
      aiDraftsEl.appendChild(el("p", "ai-status", "Added " + chosen.length + (chosen.length === 1 ? " task." : " tasks.")));
    };
    row.appendChild(addBtn);
    row.appendChild(el("p", "ai-note", "Drafted by Claude. Untick anything you don't want."));
    aiDraftsEl.appendChild(row);
  }

  // ---------- daily Slack reminder settings ----------
  var reminderCard = document.getElementById("reminderCard");
  var remindersBtn = document.getElementById("remindersBtn");
  var remStatus = document.getElementById("remStatus");
  var remChannelRow = document.getElementById("remChannelRow");
  var remChannel = document.getElementById("remChannel");
  var remSaved = null;            // settings as last loaded/saved
  var remChannelsLoaded = false;
  var REMINDER_ERRORS = {
    rate_limited: "That's several tests in a row. Try again in a few minutes.",
    not_set_up: "Save your settings first, then send a test.",
    channel_required: "Pick a channel, or choose Direct message.",
    invalid_input: "Check the time and try again.",
    slack_disabled: "Slack reminders aren't set up on this server yet."
  };
  function remError(out){ return out.message || REMINDER_ERRORS[out.error] || "Slack didn't accept that. Please try again."; }
  function remDest(){ return document.querySelector('input[name="remDest"]:checked').value; }
  function browserTimezone(){
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch(e){ return "UTC"; }
  }

  async function loadReminderChannels(selected){
    if (remChannelsLoaded) return;
    remChannel.innerHTML = "";
    var loading = document.createElement("option");
    loading.textContent = "Loading channels…";
    remChannel.appendChild(loading);
    var out = await window.TaskApi.reminders.call("GET", "/channels");
    remChannel.innerHTML = "";
    if (out.error){ remStatus.textContent = remError(out); return; }
    if (!out.channels.length){
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "No channels yet. Invite the Task Organizer bot to one you're in.";
      remChannel.appendChild(none);
      return;
    }
    out.channels.forEach(function(c){
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = (c.isPrivate ? "🔒 " : "#") + c.name;
      if (c.id === selected) o.selected = true;
      remChannel.appendChild(o);
    });
    remChannelsLoaded = true;
  }
  function syncDestination(){
    var channel = remDest() === "channel";
    remChannelRow.hidden = !channel;
    if (channel) loadReminderChannels(remSaved && remSaved.channelId);
  }
  document.querySelectorAll('input[name="remDest"]').forEach(function(r){ r.addEventListener("change", syncDestination); });

  async function openReminders(){
    reminderCard.hidden = false;
    remindersBtn.setAttribute("aria-expanded", "true");
    remStatus.textContent = "";
    var out;
    try { out = await window.TaskApi.reminders.get(); } catch(e){ return; }
    document.getElementById("reminderOff").hidden = !!out.slackEnabled;
    document.getElementById("reminderForm").hidden = !out.slackEnabled;
    if (!out.slackEnabled) return;
    var st = out.settings;
    remSaved = st;
    document.getElementById("remEnabled").checked = st.enabled;
    document.getElementById("remTime").value = st.time;
    document.getElementById("remWeekdays").checked = st.weekdaysOnly;
    document.getElementById("remTz").textContent = "your time (" + (st.timezone || browserTimezone()) + ")";
    document.querySelector('input[name="remDest"][value="' + st.destination + '"]').checked = true;
    syncDestination();
  }
  function closeReminders(){
    reminderCard.hidden = true;
    remindersBtn.setAttribute("aria-expanded", "false");
  }
  remindersBtn.addEventListener("click", function(){ reminderCard.hidden ? openReminders() : closeReminders(); });
  document.getElementById("reminderClose").addEventListener("click", closeReminders);

  document.getElementById("remSave").addEventListener("click", async function(){
    var body = {
      enabled: document.getElementById("remEnabled").checked,
      time: document.getElementById("remTime").value || "09:00",
      timezone: browserTimezone(),
      weekdaysOnly: document.getElementById("remWeekdays").checked,
      destination: remDest(),
      channelId: remDest() === "channel" ? (remChannel.value || null) : null
    };
    remStatus.textContent = "Saving…";
    var out = await window.TaskApi.reminders.call("PUT", "", body);
    if (out.error){ remStatus.textContent = remError(out); return; }
    remSaved = out.settings;
    document.getElementById("remTz").textContent = "your time (" + out.settings.timezone + ")";
    var where = out.settings.destination === "channel" ? "#" + out.settings.channelName : "a direct message";
    remStatus.textContent = out.settings.enabled
      ? "Saved. You'll get it at " + out.settings.time + (out.settings.weekdaysOnly ? " on weekdays" : " every day") + ", in " + where + "."
      : "Saved. Daily reminders are off.";
  });
  document.getElementById("remTest").addEventListener("click", async function(){
    remStatus.textContent = "Sending…";
    var out = await window.TaskApi.reminders.call("POST", "/test");
    remStatus.textContent = out.error ? remError(out) : "Sent! Check Slack.";
  });

  async function boot(){
    var me = null;
    try { me = await window.TaskApi.me(); } catch(e){ me = null; }
    if (!me){ setBanner(SERVER_ERROR_MSG); return; }
    renderUser(me);
    initAssistant();

    backend = "db";
    col = window.TaskApi.collection("tasks");
    reviewCol = window.TaskApi.collection("reviews");
    boardsCol = window.TaskApi.collection("boards");

    boardsCol.onSnapshot(function(snap){
      var list = snap.docs.map(function(d){
        var data = d.data() || {};
        return {
          id: d.id,
          name: data.name || "Untitled",
          createdAt: data.createdAt || 0,
          order: typeof data.order === "number" ? data.order : 0,
          manualSort: !!data.manualSort
        };
      });
      onBoardsChanged(list);
    }, function(err){ setBanner(SERVER_ERROR_MSG); });
    col.onSnapshot(function(snap){
      var list = snap.docs.map(function(d){
        var data = d.data() || {};
        return {
          id: d.id,
          text: data.text || "",
          status: data.status || "open",
          priority: normalizePriority(data.priority),
          comment: data.comment || "",
          board: data.board || null,
          createdDate: data.createdDate || TODAY,
          doneDate: data.doneDate || null,
          dueDate: data.dueDate || null,
          snoozedUntil: data.snoozedUntil || null,
          repeat: data.repeat || null,
          createdAt: data.createdAt || 0,
          manualOrder: typeof data.manualOrder === "number" ? data.manualOrder : 0
        };
      });
      onTasksChanged(list);
    }, function(err){ setBanner(SERVER_ERROR_MSG); });
    reviewCol.onSnapshot(function(snap){
      var list = snap.docs.map(function(d){
        var data = d.data() || {};
        return { id: d.id, board: data.board || null, notes: data.notes || "", reviewedAt: data.reviewedAt || null };
      });
      onReviewsChanged(list);
    }, function(err){ /* reviews are non-critical; keep tasks working */ });
    render();
}
  boot();
})();
