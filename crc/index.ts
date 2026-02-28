import { Hono } from 'hono';
import { Bot, webhookCallback, InlineKeyboard } from 'grammy';

type Env = {
  TELEGRAM_TOKEN: string;
  ADMIN_ID: string;
};

interface VacancyData {
  company: string;
  industry: string;
  tags: string[];
  position: string;
  salary: string;
  description: string;
  contact: string;
  location: string;
}

interface Session {
  step: string;
  vacancy: Partial<VacancyData>;
  selectedTags: string[];
  waitingFor: string | null;
}

const sessions = new Map<number, Session>();
const lastVacancies = new Map<number, { hash: string; timestamp: number }>();

const INDUSTRY_HASHTAGS: Record<string, string[]> = {
  'Крипта / Web3': ['#Крипта', '#Web3', '#Crypto', '#Blockchain'],
  'Гемблинг / iGaming': ['#Гемблинг', '#iGaming', '#Gambling', '#Casino'],
  'Процессинг / Платежи': ['#Процессинг', '#Платежи', '#Payments', '#Processing'],
  'P2P / Дропы': ['#P2P', '#Дропы', '#Drops', '#Обнал'],
  'Фрод-мониторинг / AML': ['#AML', '#ФродМониторинг', '#KYC', '#Compliance'],
  'IT / Разработка': ['#IT', '#Dev', '#Разработка', '#Программист'],
  'Другое': ['#Другое', '#Other']
};

const FORBIDDEN_TERMS = [
  'adult', 'porn', '18+', 'nutra', 'pharma', 'лекарств',
  'spam', 'рассылк', 'support', 'чат', 'игрок', 'player',
  'casino', 'казино', 'binary', 'forex', 'форекс', 'cfd'
];

function validateText(text: string, fieldName: string): { valid: boolean; error?: string } {
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u;
  const capsRatio = text.split('').filter(c => c === c.toUpperCase() && c.match(/[А-ЯA-Z]/)).length / Math.max(text.length, 1);
  const urlRegex = /https?:\/\/[^\s]+|t\.me\/[^\s]+/;
  const multipleExclamations = /!{2,}/;
  
  for (const term of FORBIDDEN_TERMS) {
    if (text.toLowerCase().includes(term)) {
      return { valid: false, error: `❌ В поле '${fieldName}' обнаружено запрещённое слово.` };
    }
  }
  
  if (emojiRegex.test(text)) {
    return { valid: false, error: `❌ В поле '${fieldName}' обнаружены эмодзи.` };
  }
  
  if (capsRatio > 0.5 && text.length > 10) {
    return { valid: false, error: `❌ В поле '${fieldName}' слишком много заглавных.` };
  }
  
  if (urlRegex.test(text)) {
    return { valid: false, error: `❌ В поле '${fieldName}' обнаружены ссылки.` };
  }
  
  if (multipleExclamations.test(text)) {
    return { valid: false, error: `❌ В поле '${fieldName}' много восклицательных.` };
  }
  
  return { valid: true };
}

const app = new Hono<{ Bindings: Env }>();

app.post('/webhook', async (c) => {
  const bot = new Bot(c.env.TELEGRAM_TOKEN);
  const ADMIN_ID = parseInt(c.env.ADMIN_ID);
  const update = await c.req.json();

  bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    
    const existingSession = sessions.get(userId);
    if (existingSession) {
      const keyboard = new InlineKeyboard()
        .text('✅ Продолжить', 'continue_vacancy').row()
        .text('🆕 Начать заново', 'new_vacancy');
      
      await ctx.reply('🔄 У вас есть незаконченная вакансия. Хотите продолжить или начать заново?', { reply_markup: keyboard });
      return;
    }
    
    sessions.set(userId, { step: 'start', vacancy: { company: 'NDA' }, selectedTags: [], waitingFor: null });
    
    const keyboard = new InlineKeyboard().text('✅ Начать', 'start_vacancy');
    await ctx.reply('👋 Привет! Я — бот канала @DreamITJob\n\nРад познакомиться! Я здесь, чтобы помочь вам разместить вакансию бесплатно.\n\n📢 Кто нас смотрит\nАудитория — IT, Fintech, high-risk.\n\n💡 Что нужно знать\n• Всё бесплатно\n• Вакансия пройдёт модерацию\n\n📋 Правила\n• Тематика: только IT / Fintech / high-risk\n• Без эмодзи, ссылок, капслока\n• NDA разрешён\n\n🔍 Полные правила — /rules\n\n✅ Готовы? Нажимайте кнопку!', { reply_markup: keyboard });
  });

  bot.command('rules', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('✅ Разместить вакансию', 'start_vacancy').row()
      .text('🔒 Памятка', 'show_safety').row()
      .text('◀️ В начало', 'back_to_start');
    
    await ctx.reply(
      '📮 ПОЛНЫЕ ПРАВИЛА\n\nНарушение = предупреждение / бан 24ч / блокировка\n\n' +
      '1. Тематика\n• Только IT / iTech / high-risk\n• Запрещены: adult, nutra, pharma, схемный трафик\n• Запрещены финансы: бинарные опционы, CFD, Forex, контакты с игроками\n\n' +
      '2. Оформление\n• Без эмодзи, CAPS LOCK\n• Запрещены !!!, ссылки, упоминания тг-ботов\n\n' +
      '3. Компания\n• NDA разрешён\n• Запрещено выдумывать название\n\n' +
      '4. Частота\n• Одну вакансию можно присылать не чаще 1 раза в 24 часа\n\n' +
      '5. Ответственность\n• Нарушение правил = предупреждение / бан 24ч / блокировка',
      { reply_markup: keyboard }
    );
  });

  bot.command('safety', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('✅ Разместить вакансию', 'start_vacancy').row()
      .text('📋 Правила', 'show_rules').row()
      .text('◀️ В начало', 'back_to_start');
    
    await ctx.reply(
      '🔒 Памятка для соискателей\n\n' +
      'Мы проверяем вакансии и удаляем явный скам, но не можем гарантировать 100% безопасность.\n\n' +
      '⛔️ Обратите внимание:\n• Работодатели не берут деньги за трудоустройство\n• Схемный трафик — уголовное преступление\n• Не передавайте личные платёжные данные\n• Не продавайте то, в чём не разбираетесь\n• Осторожно с вакансиями в ЮВА (Мьянма, Таиланд, Камбоджа, Лаос, Вьетнам, Индонезия, Филиппины)\n\n' +
      '✅ Рекомендуем:\n• Проверить наличие сайта/соцсетей у компании\n• Понимать, что продаёте\n• Искать информацию о работодателе\n\n' +
      '❗️ Мы не несём ответственности за последствия сотрудничества с работодателями.',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  bot.command('cancel', async (ctx) => {
    sessions.delete(ctx.from.id);
    await ctx.reply('❌ Отменено. /start если передумаешь');
  });

  bot.command('new', async (ctx) => {
    const userId = ctx.from.id;
    sessions.delete(userId);
    sessions.set(userId, { step: 'industry', vacancy: { company: 'NDA' }, selectedTags: [], waitingFor: null });
    
    const keyboard = new InlineKeyboard()
      .text('🔷 Крипта / Web3', 'ind_crypto').row()
      .text('🎰 Гемблинг / iGaming', 'ind_gambling').row()
      .text('💳 Процессинг / Платежи', 'ind_payments').row()
      .text('🔄 P2P / Дропы', 'ind_p2p').row()
      .text('🛡️ Фрод / AML', 'ind_fraud').row()
      .text('💻 IT / Разработка', 'ind_it').row()
      .text('➡️ Другое', 'ind_other');
    
    await ctx.reply('🆕 Новая вакансия\n\nШаг 1 из 8 — Сфера\n👇 Выбери направление:', { reply_markup: keyboard });
  });

  bot.on('callback_query:data', async (ctx) => {
    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;
    let session = sessions.get(userId);

    if (!session) {
      session = { step: 'start', vacancy: { company: 'NDA' }, selectedTags: [], waitingFor: null };
      sessions.set(userId, session);
    }

    if (data === 'continue_vacancy') {
      if (session.step === 'industry') {
        const keyboard = new InlineKeyboard()
          .text('🔷 Крипта / Web3', 'ind_crypto').row()
          .text('🎰 Гемблинг / iGaming', 'ind_gambling').row()
          .text('💳 Процессинг / Платежи', 'ind_payments').row()
          .text('🔄 P2P / Дропы', 'ind_p2p').row()
          .text('🛡️ Фрод / AML', 'ind_fraud').row()
          .text('💻 IT / Разработка', 'ind_it').row()
          .text('➡️ Другое', 'ind_other');
        await ctx.editMessageText('Шаг 1 из 8 — Сфера\n👇 Выбери направление:', { reply_markup: keyboard });
      }
      return;
    }
    
    else if (data === 'new_vacancy') {
      sessions.delete(userId);
      await ctx.editMessageText('🆕 Начинаем заново. Отправьте /start');
      return;
    }

    else if (data === 'show_rules') {
      const keyboard = new InlineKeyboard()
        .text('✅ Разместить вакансию', 'start_vacancy').row()
        .text('🔒 Памятка', 'show_safety').row()
        .text('◀️ Назад к safety', 'back_to_safety');
      
      await ctx.editMessageText(
        '📮 ПОЛНЫЕ ПРАВИЛА\n\nНарушение = предупреждение / бан 24ч / блокировка\n\n' +
        '1. Тематика\n• Только IT / iTech / high-risk\n• Запрещены: adult, nutra, pharma, схемный трафик\n• Запрещены финансы: бинарные опционы, CFD, Forex, контакты с игроками\n\n' +
        '2. Оформление\n• Без эмодзи, CAPS LOCK\n• Запрещены !!!, ссылки, упоминания тг-ботов\n\n' +
        '3. Компания\n• NDA разрешён\n• Запрещено выдумывать название\n\n' +
        '4. Частота\n• Одну вакансию можно присылать не чаще 1 раза в 24 часа\n\n' +
        '5. Ответственность\n• Нарушение правил = предупреждение / бан 24ч / блокировка',
        { reply_markup: keyboard }
      );
    }

    else if (data === 'show_safety') {
      await ctx.deleteMessage();
      await ctx.reply(
        '🔒 Памятка для соискателей\n\n' +
        'Мы проверяем вакансии и удаляем явный скам, но не можем гарантировать 100% безопасность.\n\n' +
        '⛔️ Обратите внимание:\n• Работодатели не берут деньги за трудоустройство\n• Схемный трафик — уголовное преступление\n• Не передавайте личные платёжные данные\n• Не продавайте то, в чём не разбираетесь\n• Осторожно с вакансиями в ЮВА (Мьянма, Таиланд, Камбоджа, Лаос, Вьетнам, Индонезия, Филиппины)\n\n' +
        '✅ Рекомендуем:\n• Проверить наличие сайта/соцсетей у компании\n• Понимать, что продаёте\n• Искать информацию о работодателе\n\n' +
        '❗️ Мы не несём ответственности за последствия сотрудничества с работодателями.',
        { parse_mode: 'Markdown' }
      );
    }

    else if (data === 'back_to_safety') {
      await ctx.deleteMessage();
      await ctx.reply(
        '🔒 Памятка для соискателей\n\n' +
        'Мы проверяем вакансии и удаляем явный скам, но не можем гарантировать 100% безопасность.\n\n' +
        '⛔️ Обратите внимание:\n• Работодатели не берут деньги за трудоустройство\n• Схемный трафик — уголовное преступление\n• Не передавайте личные платёжные данные\n• Не продавайте то, в чём не разбираетесь\n• Осторожно с вакансиями в ЮВА (Мьянма, Таиланд, Камбоджа, Лаос, Вьетнам, Индонезия, Филиппины)\n\n' +
        '✅ Рекомендуем:\n• Проверить наличие сайта/соцсетей у компании\n• Понимать, что продаёте\n• Искать информацию о работодателе\n\n' +
        '❗️ Мы не несём ответственности за последствия сотрудничества с работодателями.',
        { parse_mode: 'Markdown' }
      );
    }

    else if (data === 'back_to_start') {
      await ctx.deleteMessage();
      await ctx.reply('👋 Привет! Я — бот канала @DreamITJob\n\nНапишите /start чтобы начать');
    }

    else if (data === 'start_vacancy') {
      session.step = 'industry';
      const keyboard = new InlineKeyboard()
        .text('🔷 Крипта / Web3', 'ind_crypto').row()
        .text('🎰 Гемблинг / iGaming', 'ind_gambling').row()
        .text('💳 Процессинг / Платежи', 'ind_payments').row()
        .text('🔄 P2P / Дропы', 'ind_p2p').row()
        .text('🛡️ Фрод / AML', 'ind_fraud').row()
        .text('💻 IT / Разработка', 'ind_it').row()
        .text('➡️ Другое', 'ind_other');
      
      await ctx.editMessageText('Шаг 1 из 8 — Сфера\n👇 Выбери направление:', { reply_markup: keyboard });
    }

    else if (data.startsWith('ind_')) {
      const industryMap: Record<string, string> = {
        ind_crypto: 'Крипта / Web3',
        ind_gambling: 'Гемблинг / iGaming',
        ind_payments: 'Процессинг / Платежи',
        ind_p2p: 'P2P / Дропы',
        ind_fraud: 'Фрод-мониторинг / AML',
        ind_it: 'IT / Разработка',
        ind_other: 'Другое'
      };
      
      session.vacancy.industry = industryMap[data];
      session.step = 'hashtags';
      session.selectedTags = [];
      
      const hashtags = INDUSTRY_HASHTAGS[session.vacancy.industry] || INDUSTRY_HASHTAGS['Другое'];
      const keyboard = new InlineKeyboard();
      
      hashtags.forEach(tag => {
        keyboard.text(tag, `tag_${tag}`).row();
      });
      keyboard.text('✅ Готово', 'tags_done');
      
      await ctx.editMessageText('Шаг 2 из 8 — Хэштеги\n🏷 Выбери один или несколько:', { reply_markup: keyboard });
    }

    else if (data.startsWith('tag_')) {
      const tag = data.replace('tag_', '');
      
      if (session.selectedTags.includes(tag)) {
        session.selectedTags = session.selectedTags.filter(t => t !== tag);
      } else {
        session.selectedTags.push(tag);
      }
      
      const hashtags = INDUSTRY_HASHTAGS[session.vacancy.industry] || INDUSTRY_HASHTAGS['Другое'];
      const keyboard = new InlineKeyboard();
      
      hashtags.forEach(t => {
        const isSelected = session.selectedTags.includes(t);
        keyboard.text(`${isSelected ? '✅ ' : ''}${t}`, `tag_${t}`).row();
      });
      keyboard.text('✅ Готово', 'tags_done');
      
      await ctx.editMessageText(
        `Выбрано: ${session.selectedTags.join(', ') || 'ничего'}\n\nШаг 2 из 8 — Хэштеги\n🏷 Выбери:`,
        { reply_markup: keyboard }
      );
    }

    else if (data === 'tags_done') {
      if (session.selectedTags.length === 0) {
        await ctx.answerCallbackQuery({ text: '❌ Выбери хотя бы один хэштег!', show_alert: true });
        return;
      }
      
      session.vacancy.tags = session.selectedTags;
      session.step = 'position';
      
      const keyboard = new InlineKeyboard()
        .text('👨‍💻 Junior', 'pos_junior').row()
        .text('👨‍🔧 Middle', 'pos_middle').row()
        .text('👨‍🏫 Senior', 'pos_senior').row()
        .text('✏️ Другое', 'pos_other');
      
      await ctx.editMessageText('Шаг 3 из 8 — Уровень\n📊 Выбери грейд:', { reply_markup: keyboard });
    }

    else if (data.startsWith('pos_')) {
      const posMap: Record<string, string> = {
        pos_junior: 'Junior',
        pos_middle: 'Middle',
        pos_senior: 'Senior',
        pos_other: 'Другое'
      };
      
      session.vacancy.position = posMap[data];
      session.step = 'salary';
      
      const keyboard = new InlineKeyboard()
        .text('💰 до $1000', 'sal_1').row()
        .text('💰 $1000-2000', 'sal_2').row()
        .text('💰 $2000-3000', 'sal_3').row()
        .text('💰 $3000-5000', 'sal_4').row()
        .text('💰 $5000+', 'sal_5').row()
        .text('✏️ Другое', 'sal_other');
      
      await ctx.editMessageText('Шаг 4 из 8 — Зарплата\n💵 Выбери вилку:', { reply_markup: keyboard });
    }

    else if (data.startsWith('sal_')) {
      if (data === 'sal_other') {
        session.waitingFor = 'salary';
        await ctx.editMessageText('✏️ Введи зарплату вручную\n\nНапример: "от 3000$", "2500-3500$"\n\n👇 Введи текст:');
        return;
      }
      
      const salMap: Record<string, string> = {
        sal_1: 'до $1000',
        sal_2: '$1000-2000',
        sal_3: '$2000-3000',
        sal_4: '$3000-5000',
        sal_5: '$5000+'
      };
      
      session.vacancy.salary = salMap[data];
      session.step = 'description';
      session.waitingFor = 'description';
      
      await ctx.editMessageText(
        'Шаг 5 из 8 — Описание\n📝 Напиши подробное описание (задачи, требования, условия)\n\n✏️ Введи текст (без эмодзи, ссылок, капслока):'
      );
    }

    else if (data.startsWith('cont_')) {
      if (data === 'cont_username') {
        session.waitingFor = 'contact';
        await ctx.editMessageText('📱 Введите @username:');
      }
      else if (data === 'cont_email') {
        session.waitingFor = 'contact';
        await ctx.editMessageText('📧 Введите email:');
      }
      else if (data === 'cont_other') {
        session.waitingFor = 'contact';
        await ctx.editMessageText('✏️ Введите контакт (WhatsApp, Signal и т.д.):');
      }
    }

    else if (data.startsWith('loc_')) {
      const locMap: Record<string, string> = {
        loc_remote: 'Удалённо',
        loc_office: 'Офис',
        loc_hybrid: 'Гибрид'
      };
      
      if (data === 'loc_other') {
        session.waitingFor = 'location';
        await ctx.editMessageText('✏️ Введи локацию вручную (город, страна):');
        return;
      }
      
      session.vacancy.location = locMap[data];
      session.step = 'confirm';
      
      const v = session.vacancy;
      await ctx.reply(
        `📋 Проверьте данные:\n\n` +
        `🏢 Компания: ${v.company}\n` +
        `📊 Сфера: ${v.industry}\n` +
        `🏷 Хэштеги: ${v.tags?.join(' ')}\n` +
        `👤 Должность: ${v.position}\n` +
        `💰 Зарплата: ${v.salary}\n` +
        `📝 Описание:\n${v.description}\n` +
        `📞 Контакт: ${v.contact}\n` +
        `📍 Локация: ${v.location}`
      );
      
      const keyboard = new InlineKeyboard()
        .text('✅ Да, отправить', 'confirm_yes').row()
        .text('❌ Отмена', 'confirm_cancel');
      
      await ctx.reply('Всё верно?', { reply_markup: keyboard });
    }

    else if (data === 'confirm_yes') {
      const v = session.vacancy;
      
      const hash = JSON.stringify(v);
      const last = lastVacancies.get(userId);
      if (last && last.hash === hash) {
        const diff = Date.now() - last.timestamp;
        if (diff < 24 * 60 * 60 * 1000) {
          await ctx.editMessageText('❌ Эта вакансия уже отправлялась менее 24ч назад.');
          return;
        }
      }
      
      lastVacancies.set(userId, { hash, timestamp: Date.now() });
      
      if (ADMIN_ID) {
        await ctx.api.sendMessage(
          ADMIN_ID,
          `💼 ${v.position}\n\n` +
          `Компания: ${v.company}\n` +
          `Сфера: ${v.industry}\n` +
          `💰 ${v.salary}\n` +
          `📍 ${v.location}\n\n` +
          `${v.description}\n\n` +
          `📞 ${v.contact}\n\n` +
          `${v.tags?.join(' ')}`
        );
      }
      
      await ctx.editMessageText(
        '✅ Спасибо! Вакансия отправлена на модерацию.\n\n' +
        '📢 Появится в @DreamITJob после проверки.\n\n' +
        '🆕 /new — новая вакансия\n' +
        '📋 /rules — правила\n' +
        '🔒 /safety — памятка'
      );
      sessions.delete(userId);
    }

    else if (data === 'confirm_cancel') {
      sessions.delete(userId);
      await ctx.editMessageText('❌ Отменено. /start если передумаешь');
    }
  });

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const session = sessions.get(userId);
    if (!session) return;

    const text = ctx.message.text;

    if (session.waitingFor === 'salary') {
      const validation = validateText(text, 'зарплата');
      if (!validation.valid) {
        await ctx.reply(validation.error! + '\nПопробуй ещё раз:');
        return;
      }
      
      session.vacancy.salary = text;
      session.step = 'description';
      session.waitingFor = 'description';
      
      await ctx.reply(
        'Шаг 5 из 8 — Описание\n📝 Напиши подробное описание (задачи, требования, условия)\n\n✏️ Введи текст (без эмодзи, ссылок, капслока):'
      );
    }

    else if (session.waitingFor === 'description') {
      const validation = validateText(text, 'описание');
      if (!validation.valid) {
        await ctx.reply(validation.error! + '\nПопробуй ещё раз:');
        return;
      }
      
      session.vacancy.description = text;
      session.step = 'contact';
      session.waitingFor = 'contact';
      
      const keyboard = new InlineKeyboard()
        .text('📱 @username', 'cont_username').row()
        .text('📧 Email', 'cont_email').row()
        .text('✏️ Другое', 'cont_other');
      
      await ctx.reply('Шаг 6 из 8 — Контакт\n📞 Укажи, как связаться:', { reply_markup: keyboard });
    }

    else if (session.waitingFor === 'contact') {
      if (/(https?:\/\/|t\.me\/)/.test(text.toLowerCase())) {
        await ctx.reply('❌ Ссылки запрещены. Введи контакт без ссылок:');
        return;
      }
      
      session.vacancy.contact = text;
      session.step = 'location';
      session.waitingFor = 'location';
      
      const keyboard = new InlineKeyboard()
        .text('🌍 Удалённо', 'loc_remote').row()
        .text('🏢 Офис', 'loc_office').row()
        .text('🔄 Гибрид', 'loc_hybrid').row()
        .text('✏️ Другое', 'loc_other');
      
      await ctx.reply('Шаг 7 из 8 — Локация\n📍 Где работа?', { reply_markup: keyboard });
    }

    else if (session.waitingFor === 'location') {
      const validation = validateText(text, 'локация');
      if (!validation.valid) {
        await ctx.reply(validation.error! + '\nПопробуй ещё раз:');
        return;
      }
      
      session.vacancy.location = text;
      session.step = 'confirm';
      session.waitingFor = null;
      
      const v = session.vacancy;
      await ctx.reply(
        `📋 Проверьте данные:\n\n` +
        `🏢 Компания: ${v.company}\n` +
        `📊 Сфера: ${v.industry}\n` +
        `🏷 Хэштеги: ${v.tags?.join(' ')}\n` +
        `👤 Должность: ${v.position}\n` +
        `💰 Зарплата: ${v.salary}\n` +
        `📝 Описание:\n${v.description}\n` +
        `📞 Контакт: ${v.contact}\n` +
        `📍 Локация: ${v.location}`
      );
      
      const keyboard = new InlineKeyboard()
        .text('✅ Да, отправить', 'confirm_yes').row()
        .text('❌ Отмена', 'confirm_cancel');
      
      await ctx.reply('Всё верно?', { reply_markup: keyboard });
    }
  });

  const handler = webhookCallback(bot, 'hono');
  return handler(c);
});

app.get('/', (c) => c.text('Bot is running'));

export default app;
