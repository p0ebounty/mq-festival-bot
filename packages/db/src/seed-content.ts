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

/**
 * Задания: картинка плюс конкретная цель, что из неё получить.
 *
 * В отличие от миров, где участник волен делать что угодно, здесь у него
 * есть цель — и это отправная точка для тех, кто растерялся и не знает,
 * чего хотеть (ADR 0013).
 *
 * `title` — внутреннее имя, участнику НЕ показывается: в нём содержится
 * ответ («гонец → дрон»), а сама формулировка задания его не называет —
 * догадаться должен человек.
 *
 * `prompt` рисует основу и пишется по-английски: модели так работают
 * заметно лучше. `task` читает участник, поэтому он по-русски.
 *
 * ⚠️ Задания №6, №7 и №10 в исходном наборе были цепочками из трёх-четырёх
 * превращений. Сведены к одному шагу по решению заказчика: одна картинка —
 * одно задание — один промпт.
 */
export const TASKS: ReadonlyArray<{ title: string; prompt: string; task: string }> = [
  {
    title: 'колесница → болид',
    prompt: 'A Roman chariot with two horses races across the arena of the Colosseum, ' +
      'dust flying from the wheels, the stands packed with spectators, ' +
      'detailed realistic illustration',
    task: 'Поставь на эту арену болид Формулы-1. Всё остальное оставь как было.',
  },
  {
    title: 'кто строит пирамиду',
    prompt: 'Building a pyramid in ancient Egypt, thousands of workers hauling a huge stone ' +
      'block on ropes, desert sand and heat haze, detailed realistic illustration',
    task: 'Пусть эту же пирамиду строит современная техника.',
  },
  {
    title: 'гонец → дрон',
    prompt: 'A messenger on a lathered horse carries a scroll with a wax seal through the forest ' +
      'towards the castle gates, dusk, torches burning on the walls, detailed illustration',
    task: 'Замени гонца на то, чем письма доставляют сегодня.',
  },
  {
    title: 'рыцарь → герой будущего',
    prompt: 'A knight in steel plate armour with a sword and shield stands on the field after ' +
      'the battle, banners and drifting smoke, cinematic illustration',
    task: 'Поставь на его место героя из будущего.',
  },
  {
    title: 'замок → штаб-квартира',
    prompt: 'A feudal stone castle with towers rises above a village of thatched roofs, ' +
      'peasants walking up the road, low angle view, detailed illustration',
    task: 'Замени замок на здание, где сегодня сидит власть. Деревню не трогай.',
  },
  {
    title: 'мастерская → производство без людей',
    prompt: 'A craftsman in his workshop forges a horseshoe by hand with a hammer at the forge, ' +
      'an apprentice works the bellows, warm firelight, detailed illustration',
    task: 'Замени ручную кузницу на производство, где вообще нет людей.',
  },
  {
    title: 'каравелла → атомный ледокол',
    prompt: 'A wooden caravel under white sails in the open ocean, sailors on the yards, ' +
      'seagulls, horizon line, realistic illustration',
    task: 'Пусть этот океан пересечёт атомный ледокол вместо каравеллы.',
  },
  {
    title: 'библиотека → дата-центр',
    prompt: 'The Library of Alexandria, shelves of papyrus scrolls, scribes at their desks, ' +
      'oil lamps, tall columns, realistic illustration',
    task: 'Замени свитки на то, где знания хранят сегодня.',
  },
  {
    title: 'столкновение эпох',
    prompt: 'A medieval town fair, traders behind wooden stalls, a potter and a blacksmith at work, ' +
      'a crowd of townsfolk, half-timbered houses, detailed illustration',
    task: 'Добавь на эту ярмарку два предмета из нашего времени. Какие — решай сам.',
  },
  {
    title: 'рынок сквозь века',
    prompt: 'A market square of the ancient world, traders with clay amphorae, ox carts, ' +
      'stone stalls under awnings, bright sunny day, detailed realistic illustration',
    task: 'Перенеси этот рынок в 2050 год.',
  },
];
