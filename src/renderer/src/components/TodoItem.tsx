import { useStore } from '../store'
import { renderInline } from './InlineMarkdown'
import { resolveTarget } from '../lib/links'
import { formatShort } from '../lib/dates'
import type { Todo } from '../lib/todos'

export function TodoItem({ todo, showDate = false }: { todo: Todo; showDate?: boolean }): React.JSX.Element {
  const toggleTask = useStore((s) => s.toggleTask)
  const openNote = useStore((s) => s.openNote)
  const files = useStore((s) => s.files)
  const navigate = useStore((s) => s.navigate)
  const openTag = useStore((s) => s.openTag)
  const index = useStore((s) => s.index)
  const isResolved = (raw: string): boolean =>
    (resolveTarget(raw, files.map((f) => f.path)) ?? index.resolvePath(raw)) !== null
  return (
    <div className={'todo-item' + (todo.checked ? ' done' : '')}>
      <input type="checkbox" checked={todo.checked} onChange={() => toggleTask(todo.sourcePath, todo.line)} />
      <span className="todo-text">
        {todo.text
          ? renderInline(todo.text, { isResolved, onNavigate: navigate, onTag: openTag })
          : '(empty task)'}
      </span>
      {showDate && todo.date && <span className="todo-date">{formatShort(todo.date)}</span>}
      <span className="todo-source" onClick={(e) => (e.metaKey || e.ctrlKey ? null : openNote(todo.sourcePath))}>
        {todo.sourceName}
      </span>
    </div>
  )
}
