/**
 * Каталог профессий из ТЗ. `promptFragment` — кусок английского промпта,
 * который подмешивается к идее участника, НЕ заменяя её.
 *
 * Формулировки описывают одежду и обстановку, но НЕ внешность: внешность
 * берётся с фото участника и меняться не должна.
 */
export const PROFESSIONS: ReadonlyArray<{
  slug: string;
  title: string;
  description: string;
  promptFragment: string;
  sortOrder: number;
}> = [
  {
    slug: 'cosmonaut', title: 'космонавт',
    description: 'Скафандр, космическая станция, вид на Землю',
    promptFragment:
      'Dress them in a detailed white spacesuit with mission patches, helmet held under one arm, ' +
      'standing inside a bright space station module with Earth visible through the window.',
    sortOrder: 10,
  },
  {
    slug: 'doctor', title: 'врач',
    description: 'Медицинский халат, клиника будущего',
    promptFragment:
      'Dress them in a crisp modern medical coat with a stethoscope, standing in a bright ' +
      'high-tech clinic with holographic diagnostic displays behind them.',
    sortOrder: 20,
  },
  {
    slug: 'engineer', title: 'инженер',
    description: 'Каска, цех, большие механизмы',
    promptFragment:
      'Dress them in an engineering jacket and safety helmet, standing in a spacious modern ' +
      'workshop with large precision machinery and blueprints around them.',
    sortOrder: 30,
  },
  {
    slug: 'roboticist', title: 'робототехник',
    description: 'Лаборатория, роботы, механические руки',
    promptFragment:
      'Dress them in a technical lab jacket, standing in a robotics laboratory beside a ' +
      'partially assembled humanoid robot and articulated robotic arms.',
    sortOrder: 40,
  },
  {
    slug: 'scientist', title: 'учёный-исследователь',
    description: 'Лаборатория, приборы, эксперимент',
    promptFragment:
      'Dress them in a white laboratory coat with safety glasses pushed up, standing in a ' +
      'research laboratory with scientific instruments and glowing experiment apparatus.',
    sortOrder: 50,
  },
  {
    slug: 'architect', title: 'архитектор',
    description: 'Макеты, чертежи, город будущего',
    promptFragment:
      'Dress them in smart casual clothing, standing at a large table with architectural ' +
      'models and drawings, a futuristic city skyline visible through floor-to-ceiling windows.',
    sortOrder: 60,
  },
  {
    slug: 'director', title: 'директор',
    description: 'Деловой костюм, кабинет, панорама города',
    promptFragment:
      'Dress them in an elegant business suit, standing confidently in a modern executive ' +
      'office with a panoramic city view behind them.',
    sortOrder: 70,
  },
  {
    slug: 'artist', title: 'художник',
    description: 'Мастерская, краски, холсты',
    promptFragment:
      'Dress them in an artist apron with paint traces, standing in a sunlit studio surrounded ' +
      'by canvases, brushes and jars of paint.',
    sortOrder: 80,
  },
  {
    slug: 'pilot', title: 'пилот',
    description: 'Кабина, лётная форма, облака',
    promptFragment:
      'Dress them in a pilot uniform with epaulettes and headset, seated in the cockpit of a ' +
      'modern aircraft with clouds and sunlight outside the windscreen.',
    sortOrder: 90,
  },
  {
    slug: 'biotech', title: 'биоинженер',
    description: 'Вертикальные фермы, растения, биолаборатория',
    promptFragment:
      'Dress them in a clean-room lab coat, standing among vertical hydroponic farm racks ' +
      'filled with green plants under soft violet grow lights.',
    sortOrder: 100,
  },
  {
    slug: 'gamedev', title: 'разработчик игр',
    description: 'Мониторы, концепт-арты, неон',
    promptFragment:
      'Dress them in a casual hoodie, sitting at a creative workstation with several monitors ' +
      'showing game concept art, neon accent lighting in the room.',
    sortOrder: 110,
  },
  {
    slug: 'oceanographer', title: 'океанолог',
    description: 'Подводная станция, батискаф, глубина',
    promptFragment:
      'Dress them in a marine research jacket, standing inside an underwater research station ' +
      'with a large porthole showing deep blue ocean and fish outside.',
    sortOrder: 120,
  },
];

/**
 * Базовые миры для сценария 2 ТЗ. Картинки генерируются один раз при сидинге
 * и складываются к нам — участникам выдаётся случайный из пула.
 *
 * Стили намеренно разные: акварель, 3D, пиксель-арт. Так участник сразу
 * видит, что «поменять стиль» — это тоже допустимый ход.
 */
export const BASE_WORLDS: ReadonlyArray<{ title: string; prompt: string }> = [
  {
    title: 'средневековый замок',
    prompt: 'A medieval stone castle on a green hill, sunny clear day, blue sky with light clouds, ' +
      'knights with colourful banners at the gate, watercolour painting style',
  },
  {
    title: 'город на облаках',
    prompt: 'A floating city built on clouds, white towers connected by delicate bridges, ' +
      'airships drifting between them, warm sunset light, soft illustration style',
  },
  {
    title: 'подводный купол',
    prompt: 'An underwater dome settlement on the sea floor, glass panels glowing warmly, ' +
      'coral reefs and schools of fish around it, deep blue water, detailed 3D render',
  },
  {
    title: 'станция на Марсе',
    prompt: 'A research station on the surface of Mars, red rocky landscape, solar panel fields, ' +
      'a rover parked outside, dusty pink sky, cinematic photorealistic render',
  },
  {
    title: 'лесная деревня',
    prompt: 'A village built among giant ancient trees, wooden houses on the branches, ' +
      'rope bridges and lanterns, morning mist between the trunks, cosy pixel art style',
  },
  {
    title: 'вокзал будущего',
    prompt: 'A futuristic railway station hall, magnetic trains at the platforms, ' +
      'people walking under a vast glass roof, bright daylight, clean architectural illustration',
  },
];
