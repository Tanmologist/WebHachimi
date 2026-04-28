export function mountEditorShell(root: HTMLElement): void {
  root.innerHTML = `
    <header class="v2-topbar">
      <section class="v2-brand">
        <span class="v2-brand-mark">WH</span>
        <span class="v2-brand-copy">
          <strong>WebHachimi</strong>
          <small>2D 游戏编辑器 · 重构主线</small>
        </span>
      </section>
      <section class="v2-actions" aria-label="运行控制">
        <button class="v2-command is-primary" data-action="toggle-run" type="button" title="运行或冻结，快捷键 Z">
          <span class="v2-command-icon">RUN</span>
          <span>运行 / 冻结</span>
          <kbd>Z</kbd>
        </button>
        <button class="v2-command" data-action="step" type="button" title="运行单帧">
          <span class="v2-command-icon">1F</span>
          <span>单帧</span>
        </button>
        <button class="v2-command" data-action="capture" type="button" title="冻结并捕捉当前帧">
          <span class="v2-command-icon">CAP</span>
          <span>捕捉</span>
        </button>
      </section>
      <section class="v2-window-manager">
        <button class="v2-command" data-action="toggle-window-menu" type="button" title="管理工具和窗口">
          <span class="v2-command-icon">WIN</span>
          <span>窗口</span>
        </button>
        <div class="v2-window-popover" data-role="window-menu">
          <section>
            <small>工具</small>
            <div class="v2-menu-grid">
              <button data-tool="select" type="button">选择</button>
              <button data-tool="superBrush" type="button">画笔</button>
              <button data-tool="shape" type="button">区域</button>
              <button data-tool="assist" type="button">辅助</button>
            </div>
          </section>
          <section>
            <small>窗口</small>
            <div class="v2-menu-grid">
              <button data-open-panel="scene" type="button">层级</button>
              <button data-open-panel="properties" type="button">检查</button>
              <button data-open-panel="assets" type="button">资源</button>
              <button data-open-panel="tasks" type="button">任务</button>
            </div>
          </section>
        </div>
      </section>
      <section class="v2-actions v2-actions-secondary" aria-label="任务验证">
        <button class="v2-command" data-action="run-autonomous-round" type="button" title="执行一轮任务和自主测试">
          <span class="v2-command-icon">AI</span>
          <span>自治一轮</span>
        </button>
      </section>
      <section class="v2-actions v2-actions-secondary" aria-label="项目">
        <button class="v2-command" data-action="reload-project" type="button" title="先自动保存，然后从磁盘重新载入 v2 项目">
          <span class="v2-command-icon">REF</span>
          <span>刷新</span>
        </button>
      </section>
      <span class="v2-spacer"></span>
      <section class="v2-session-status" aria-label="当前状态">
        <small>模式</small>
        <span class="v2-mode" data-role="mode">编辑冻结</span>
        <small>保存</small>
        <span class="v2-save-status" data-role="save-status">自动保存就绪</span>
      </section>
    </header>
    <section class="v2-workspace">
      <section class="v2-stage" data-role="stage-shell">
        <div class="v2-stage-host" data-role="stage"></div>
        <div class="v2-stage-overlay">
          <span data-role="frame">frame 0</span>
          <span data-role="pointer">工具：选择</span>
        </div>
        <div class="v2-stage-notice">
          <span data-role="notice">准备就绪</span>
        </div>
      </section>
      <div class="v2-window-layer" data-role="window-layer">
        <div class="v2-dock-preview" aria-hidden="true"></div>
        <aside class="v2-panel v2-window v2-scene-panel" data-panel="scene">
          <header data-window-drag="scene">
            <span class="v2-panel-title">
              <strong>场景层级</strong>
              <small>文件夹、实体和选择状态</small>
            </span>
            <span class="v2-panel-controls">
              <button data-panel-action="minimize" data-panel="scene" type="button" title="最小化">_</button>
              <button data-panel-action="close" data-panel="scene" type="button" title="关闭">x</button>
            </span>
          </header>
          <div class="v2-panel-body">
            <section class="v2-tree" data-role="tree"></section>
          </div>
        </aside>
        <section class="v2-panel v2-window v2-properties-panel" data-panel="properties">
          <header data-window-drag="properties">
            <span class="v2-panel-title">
              <strong>检查器</strong>
              <small>名称、碰撞、表现和行为</small>
            </span>
            <span class="v2-panel-controls">
              <button data-panel-action="minimize" data-panel="properties" type="button" title="最小化">_</button>
              <button data-panel-action="close" data-panel="properties" type="button" title="关闭">x</button>
            </span>
          </header>
          <div class="v2-panel-body">
            <section class="v2-inspector" data-role="inspector"></section>
          </div>
        </section>
        <section class="v2-panel v2-window v2-assets-panel" data-panel="assets">
          <header data-window-drag="assets">
            <span class="v2-panel-title">
              <strong>对象资源</strong>
              <small>绑定、批注和素材说明</small>
            </span>
            <span class="v2-panel-controls">
              <button data-panel-action="minimize" data-panel="assets" type="button" title="最小化">_</button>
              <button data-panel-action="close" data-panel="assets" type="button" title="关闭">x</button>
            </span>
          </header>
          <div class="v2-panel-body">
            <section class="v2-resource-list" data-role="resources"></section>
          </div>
        </section>
        <section class="v2-panel v2-window v2-tasks-panel" data-panel="tasks">
          <header data-window-drag="tasks">
            <span class="v2-panel-title">
              <strong>任务与验证</strong>
              <small>意图、执行、trace 和自测</small>
            </span>
            <span class="v2-panel-controls">
              <button data-panel-action="minimize" data-panel="tasks" type="button" title="最小化">_</button>
              <button data-panel-action="close" data-panel="tasks" type="button" title="关闭">x</button>
            </span>
          </header>
          <div class="v2-panel-body v2-right-body">
            <section class="v2-quick-task">
              <header class="v2-task-composer-head">
                <label for="taskText">任务输入</label>
                <small>选中对象或画笔上下文会自动成为任务目标</small>
              </header>
              <textarea id="taskText" data-role="task-input" rows="3" placeholder="写给 AI 的任务。选中对象时优先作用于该对象；超级画笔结束后必须在这里描述意图。"></textarea>
              <div class="v2-task-actions">
                <span class="v2-action-group">
                  <button data-action="queue-task" type="button">排队</button>
                  <button data-action="run-ai-task" type="button">执行下一条</button>
                  <button data-action="run-autonomous-round" type="button">自治一轮</button>
                </span>
                <span class="v2-action-group">
                  <button data-action="run-autonomous-test" type="button">自测</button>
                  <button data-action="run-sweep" type="button">时间轴</button>
                  <button data-action="run-scripted-test" type="button">脚本测试</button>
                </span>
                <span class="v2-action-group">
                  <button data-action="preview-cleanup" type="button">清理预览</button>
                  <button data-action="run-cleanup" type="button">自动清理</button>
                  <button data-action="clear-brush" type="button">清除画笔</button>
                </span>
              </div>
            </section>
            <section class="v2-list" data-role="tasks"></section>
          </div>
        </section>
      </div>
    </section>
    <footer class="v2-status">
      <span>v2 项目数据：/api/v2/project · data/v2-project.json</span>
      <span>自动保存会写入磁盘；刷新按钮会重新从磁盘载入当前 v2 项目。</span>
    </footer>
  `;
}
