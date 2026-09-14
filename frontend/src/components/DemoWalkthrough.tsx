import { useState } from 'react'

const STEPS = [
  {
    title: 'Полная группировка',
    text: 'Загрузите «Полная группировка», нажмите «Запустить расчёт», на вкладке «Сеть» смотрите маршрут клиента по таймлайну.',
  },
  {
    title: 'Этап развёртывания',
    text: 'В конфигурации смените очередь запуска на 1, примените, сохраните вариант и сравните с полной группировкой.',
  },
  {
    title: 'Отказ аппарата',
    text: 'Добавьте отказ спутника с текущего маршрута (или outage шлюза), пересчитайте — увидите смену пути или причину перерыва.',
  },
  {
    title: 'Стратегии маршрута',
    text: 'На «Сети» переключите BFS ↔ Dijkstra: доступность та же, путь и длина могут отличаться; запасные пути — node-disjoint КА.',
  },
  {
    title: 'Сравнение и выгрузка',
    text: 'На «Сравнении» сопоставьте два варианта, проверьте рекомендацию; выгрузите результат cosmo-A-result-1.0.',
  },
]

export function DemoWalkthrough() {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button type="button" className="btn ghost walkthrough-reopen" onClick={() => setOpen(true)}>
        Сценарии для жюри
      </button>
    )
  }
  return (
    <div className="card-block walkthrough">
      <div className="walkthrough-head">
        <h2>Сценарии проверки</h2>
        <button type="button" className="linkish" onClick={() => setOpen(false)} title="Свернуть">
          свернуть
        </button>
      </div>
      <p className="muted tiny">Короткий чеклист для демонстрации жюри (постановка задачи).</p>
      <ol className="walkthrough-list">
        {STEPS.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
