export function mountEditorShell(root: HTMLElement): void {
  root.innerHTML = `
    <header class="v2-topbar" role="banner">
      <section class="v2-brand" aria-label="Project">
        <span class="v2-brand-mark">WH</span>
        <span class="v2-brand-copy">
          <strong>WebHachimi</strong>
          <small>Studio</small>
        </span>
      </section>

      <section class="v2-actions" role="toolbar" aria-label="Run controls">
        <button class="v2-command is-primary" data-action="toggle-run" type="button" title="运行 / 冻结">
          <span class="v2-command-icon">▶</span>
          <span>运行</span>
          <kbd>Z</kbd>
        </button>
        <button class="v2-command" data-action="step" type="button" title="单帧运行">
          <span class="v2-command-icon">▮</span>
          <span>单帧</span>
        </button>
        <button class="v2-command" data-action="capture" type="button" title="捕获当前帧">
          <span class="v2-command-icon">◎</span>
          <span>捕获</span>
        </button>
      </section>

      <section class="v2-window-manager">
        <button class="v2-command" data-action="toggle-window-menu" type="button" title="窗口">
          <span class="v2-command-icon">▣</span>
          <span>窗口</span>
        </button>
        <div class="v2-window-popover" id="v2-window-menu" data-role="window-menu" role="menu" aria-label="Window menu" aria-hidden="true">
          <section>
            <small>焦点</small>
            <div class="v2-menu-grid">
              <button data-surface-target="canvas" type="button">画布</button>
              <button data-surface-target="world" type="button">世界</button>
            </div>
          </section>
          <section>
            <small>面板</small>
            <div class="v2-menu-grid">
              <button data-open-panel="scene" type="button">世界</button>
              <button data-open-panel="properties" type="button">属性</button>
              <button data-open-panel="assets" type="button">资源</button>
              <button data-open-panel="library" type="button">资源库</button>
              <button data-open-panel="tasks" type="button">任务</button>
              <button data-open-panel="output" type="button">输出</button>
            </div>
          </section>
        </div>
      </section>

      <section class="v2-polygon-actions" data-role="polygon-actions" role="toolbar" aria-label="Polygon drawing" aria-hidden="true" hidden>
        <button class="v2-command is-primary" data-action="confirm-polygon" type="button">确认</button>
        <button class="v2-command" data-action="cancel-polygon" type="button">取消</button>
      </section>

      <section class="v2-actions v2-actions-secondary" role="toolbar" aria-label="Project">
        <button class="v2-command" data-action="reload-project" type="button" title="从磁盘刷新">
          <span class="v2-command-icon">↻</span>
          <span>刷新</span>
        </button>
      </section>

      <span class="v2-spacer"></span>

      <section class="v2-session-status" aria-label="Status" aria-live="polite">
        <small>模式</small>
        <span class="v2-mode" data-role="mode">编辑</span>
        <small>保存</small>
        <span class="v2-save-status" data-role="save-status">就绪</span>
      </section>
    </header>

    <section class="v2-super-brush-bar" data-role="super-brush-bar" aria-label="超级画笔">
      <span class="v2-super-brush-title">
        <strong>超级画笔</strong>
        <small data-role="super-brush-summary">拖动画布开始标记</small>
      </span>
      <span class="v2-super-brush-actions">
        <button class="v2-command is-primary" data-action="confirm-super-brush" type="button">确认画笔</button>
        <button class="v2-command" data-action="cancel-super-brush-session" type="button">取消</button>
      </span>
    </section>

    <section class="v2-workspace" data-layout="studio">
      <nav class="v2-toolrail" role="toolbar" aria-label="Tools">
        <button class="v2-tool-button" data-tool="select" type="button" title="选择">
          <span>↖</span>
          <small>选择</small>
        </button>
        <button class="v2-tool-button" data-tool="square" type="button" title="创建方块">
          <span>□</span>
          <small>方块</small>
        </button>
        <button class="v2-tool-button" data-tool="circle" type="button" title="创建圆形">
          <span>○</span>
          <small>圆形</small>
        </button>
        <button class="v2-tool-button" data-tool="leaf" type="button" title="柳叶笔">
          <span>◊</span>
          <small>柳叶</small>
        </button>
        <button class="v2-tool-button" data-tool="polygon" type="button" title="多边形">
          <span>△</span>
          <small>多边</small>
        </button>
        <button class="v2-tool-button" data-tool="superBrush" type="button" title="超级画笔">
          <span>✦</span>
          <small>超级</small>
        </button>
      </nav>

      <section class="v2-dock-host dockview-theme-dark" data-role="dockview" aria-label="Docked editor panels"></section>

      <aside class="v2-panel v2-window v2-scene-panel" data-panel="scene">
        <header data-window-drag="scene">
          <span class="v2-panel-title">
            <strong>世界</strong>
          </span>
          <span class="v2-panel-controls">
            <button data-panel-action="minimize" data-panel="scene" type="button" title="隐藏">−</button>
            <button data-panel-action="close" data-panel="scene" type="button" title="关闭">×</button>
          </span>
        </header>
        <div class="v2-panel-body">
          <section class="v2-tree" data-role="tree"></section>
        </div>
        <div class="v2-window-resize" data-resize="floating" data-panel="scene" title="调整世界面板大小"></div>
      </aside>

      <section class="v2-stage" data-role="stage-shell" aria-label="Canvas stage">
        <div class="v2-stage-host" data-role="stage"></div>
        <div class="v2-stage-overlay">
          <span data-role="frame">tick 0</span>
          <span data-role="pointer">工具：选择</span>
        </div>
        <div class="v2-stage-notice">
          <span data-role="notice">准备就绪</span>
        </div>
      </section>

      <section class="v2-panel v2-window v2-properties-panel" data-panel="properties">
        <header data-window-drag="properties">
          <span class="v2-panel-title">
            <strong>属性</strong>
          </span>
          <span class="v2-panel-controls">
            <button data-panel-action="minimize" data-panel="properties" type="button" title="隐藏">−</button>
            <button data-panel-action="close" data-panel="properties" type="button" title="关闭">×</button>
          </span>
        </header>
        <div class="v2-panel-body">
          <section class="v2-inspector" data-role="inspector"></section>
        </div>
        <div class="v2-window-resize" data-resize="floating" data-panel="properties" title="调整属性大小"></div>
      </section>

      <section class="v2-panel v2-window v2-assets-panel" data-panel="assets">
        <header data-window-drag="assets">
          <span class="v2-panel-title">
            <strong>资源</strong>
          </span>
          <span class="v2-panel-controls">
            <button data-panel-action="minimize" data-panel="assets" type="button" title="隐藏">−</button>
            <button data-panel-action="close" data-panel="assets" type="button" title="关闭">×</button>
          </span>
        </header>
        <div class="v2-panel-body">
          <section class="v2-resource-list" data-role="resources"></section>
        </div>
        <div class="v2-window-resize" data-resize="floating" data-panel="assets" title="调整资源大小"></div>
      </section>

      <section class="v2-panel v2-window v2-library-panel" data-panel="library">
        <header data-window-drag="library">
          <span class="v2-panel-title">
            <strong>资源库</strong>
          </span>
          <span class="v2-panel-controls">
            <button data-panel-action="minimize" data-panel="library" type="button" title="隐藏">−</button>
            <button data-panel-action="close" data-panel="library" type="button" title="关闭">×</button>
          </span>
        </header>
        <div class="v2-panel-body">
          <input data-role="resource-file-input" type="file" multiple hidden />
          <section class="v2-resource-list" data-role="resource-library"></section>
        </div>
        <div class="v2-window-resize" data-resize="floating" data-panel="library" title="调整资源库大小"></div>
      </section>

      <section class="v2-panel v2-window v2-tasks-panel" data-panel="tasks">
        <header data-window-drag="tasks">
          <span class="v2-panel-title">
            <strong>任务</strong>
          </span>
          <span class="v2-panel-controls">
            <button data-panel-action="minimize" data-panel="tasks" type="button" title="隐藏">−</button>
            <button data-panel-action="close" data-panel="tasks" type="button" title="关闭">×</button>
          </span>
        </header>
        <div class="v2-panel-body v2-right-body">
          <section class="v2-quick-task">
            <header class="v2-task-composer-head">
              <label for="taskText">任务输入</label>
            </header>
            <textarea id="taskText" data-role="task-input" rows="3" placeholder="写给 AI 的任务"></textarea>
            <div class="v2-task-actions">
              <span class="v2-action-group">
                <button data-action="queue-task" type="button">排队</button>
              </span>
            </div>
          </section>
          <section class="v2-list" data-role="tasks"></section>
        </div>
        <div class="v2-window-resize" data-resize="floating" data-panel="tasks" title="调整任务大小"></div>
      </section>

      <section class="v2-panel v2-window v2-output-panel" data-panel="output">
        <header data-window-drag="output">
          <span class="v2-panel-title">
            <strong>输出</strong>
          </span>
          <span class="v2-panel-controls">
            <button data-panel-action="minimize" data-panel="output" type="button" title="隐藏">−</button>
            <button data-panel-action="close" data-panel="output" type="button" title="关闭">×</button>
          </span>
        </header>
        <div class="v2-panel-body">
          <section class="v2-output-list" data-role="output"></section>
        </div>
        <div class="v2-window-resize" data-resize="floating" data-panel="output" title="调整输出大小"></div>
      </section>
      <div class="v2-minimized-tray" data-role="minimized-tray" role="toolbar" aria-label="Minimized panels" aria-hidden="true" hidden></div>
    </section>
    <div class="v2-context-menu" data-role="context-menu" role="menu" aria-hidden="true" hidden></div>
    <section class="v2-super-brush-task-modal" data-role="super-brush-task-modal" role="dialog" aria-modal="true" aria-hidden="true" hidden>
      <div class="v2-super-brush-task-dialog">
        <header>
          <span>
            <strong>超级画笔任务</strong>
            <small data-role="super-brush-task-summary">等待画笔上下文</small>
          </span>
        </header>
        <textarea data-role="super-brush-task-input" rows="7" placeholder="描述这次超级画笔标记要让 AI 改什么"></textarea>
        <p class="v2-super-brush-task-error" data-role="super-brush-task-error" aria-live="polite"></p>
        <footer>
          <button data-action="back-super-brush" type="button">返回画笔</button>
          <span></span>
          <button data-action="cancel-super-brush-session" type="button">取消</button>
          <button class="is-emphasis" data-action="queue-super-brush-task" type="button">排队</button>
        </footer>
      </div>
    </section>

    <footer class="v2-status">
      <span>data/v2-project.json</span>
      <span>api/v2/project</span>
    </footer>
  `;
}
