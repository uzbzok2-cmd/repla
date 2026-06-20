import {
  pool, createExam, activateExam, insertReadingPassage, insertQuestion,
  insertWritingTask, insertSpeakingQuestion, getActiveExam, getListeningParts,
} from "./db.js";

export async function seedSampleExam(): Promise<void> {
  // Check if any exam already exists
  const existing = await getActiveExam();
  if (existing) return; // already seeded

  const existing2 = await pool.query("SELECT id FROM ielts_exams LIMIT 1");
  if (existing2.rowCount && existing2.rowCount > 0) return;

  console.log("🌱 Seeding sample IELTS exam...");

  const exam = await createExam("IELTS Academic Mock Test #1");

  // ── Listening: Create 4 parts (admin uploads audio later) ──────────
  await pool.query(`
    INSERT INTO listening_parts (exam_id, part_number, audio_file_id, transcript, duration_seconds) VALUES
    ($1, 1, NULL, 'Section 1: A conversation between two people in an everyday social context. Listen to a conversation about booking a hotel room.', 480),
    ($1, 2, NULL, 'Section 2: A monologue in an everyday social context. A tour guide describing local attractions.', 480),
    ($1, 3, NULL, 'Section 3: A conversation among up to four people set in an educational/training context. Students discussing a project.', 480),
    ($1, 4, NULL, 'Section 4: A monologue on an academic subject. A lecture about environmental science.', 600)
  `, [exam.id]);

  // Listening questions (10 per part = 40 total)
  const listeningQs = [
    // Part 1
    { part: 1, num: 1,  text: "What type of room does the guest want?", type: "short_answer", opts: null, ans: "single" },
    { part: 1, num: 2,  text: "How many nights will the guest stay?", type: "short_answer", opts: null, ans: "3" },
    { part: 1, num: 3,  text: "What is the guest's surname?", type: "short_answer", opts: null, ans: "Johnson" },
    { part: 1, num: 4,  text: "Which floor is the room on?", type: "short_answer", opts: null, ans: "fourth" },
    { part: 1, num: 5,  text: "What time is breakfast served from?", type: "short_answer", opts: null, ans: "7:30" },
    { part: 1, num: 6,  text: "The hotel has a ________ near the lobby.", type: "fill_blank", opts: null, ans: "gym" },
    { part: 1, num: 7,  text: "How much is the deposit?", type: "short_answer", opts: null, ans: "50" },
    { part: 1, num: 8,  text: "What is the checkout time?", type: "short_answer", opts: null, ans: "11:00" },
    { part: 1, num: 9,  text: "Which payment method does the guest use?", type: "short_answer", opts: null, ans: "credit card" },
    { part: 1, num: 10, text: "The hotel offers a free ________ service.", type: "fill_blank", opts: null, ans: "airport shuttle" },
    // Part 2
    { part: 2, num: 11, text: "The tour starts at which location?", type: "multiple_choice", opts: ["A. City Hall", "B. Train Station", "C. Museum", "D. Park"], ans: "B" },
    { part: 2, num: 12, text: "How long does the full tour last?", type: "short_answer", opts: null, ans: "3 hours" },
    { part: 2, num: 13, text: "The market is open on ________ and Saturdays.", type: "fill_blank", opts: null, ans: "Wednesdays" },
    { part: 2, num: 14, text: "Children under ________ enter free.", type: "fill_blank", opts: null, ans: "12" },
    { part: 2, num: 15, text: "Which attraction is closed for renovation?", type: "multiple_choice", opts: ["A. Cathedral", "B. Castle", "C. Art Gallery", "D. Harbour"], ans: "C" },
    { part: 2, num: 16, text: "Lunch is available at the ________ restaurant.", type: "fill_blank", opts: null, ans: "harbour" },
    { part: 2, num: 17, text: "The guide's name is ________ .", type: "fill_blank", opts: null, ans: "Maria" },
    { part: 2, num: 18, text: "Photography is NOT permitted inside the ________ .", type: "fill_blank", opts: null, ans: "cathedral" },
    { part: 2, num: 19, text: "What is the cost of the audio guide?", type: "short_answer", opts: null, ans: "$5" },
    { part: 2, num: 20, text: "The tour ends at:", type: "multiple_choice", opts: ["A. City Hall", "B. The Park", "C. The Museum", "D. The Castle"], ans: "A" },
    // Part 3
    { part: 3, num: 21, text: "What is the topic of the students' project?", type: "short_answer", opts: null, ans: "renewable energy" },
    { part: 3, num: 22, text: "When is the project submission deadline?", type: "short_answer", opts: null, ans: "Friday" },
    { part: 3, num: 23, text: "Which library database will they use?", type: "multiple_choice", opts: ["A. JSTOR", "B. ScienceDirect", "C. PubMed", "D. Google Scholar"], ans: "B" },
    { part: 3, num: 24, text: "The professor recommends ________ as the main reference.", type: "fill_blank", opts: null, ans: "textbook" },
    { part: 3, num: 25, text: "How many pages should the report be?", type: "short_answer", opts: null, ans: "15" },
    { part: 3, num: 26, text: "Anna will focus on the ________ section.", type: "fill_blank", opts: null, ans: "introduction" },
    { part: 3, num: 27, text: "Mark is responsible for the:", type: "multiple_choice", opts: ["A. Bibliography", "B. Conclusion", "C. Data analysis", "D. Methodology"], ans: "C" },
    { part: 3, num: 28, text: "They plan to meet ________ times before submission.", type: "fill_blank", opts: null, ans: "three" },
    { part: 3, num: 29, text: "What software will they use for graphs?", type: "short_answer", opts: null, ans: "Excel" },
    { part: 3, num: 30, text: "The presentation will last how many minutes?", type: "short_answer", opts: null, ans: "10" },
    // Part 4
    { part: 4, num: 31, text: "The lecture is about which environmental issue?", type: "short_answer", opts: null, ans: "deforestation" },
    { part: 4, num: 32, text: "Every year, ________ million hectares of forest are lost.", type: "fill_blank", opts: null, ans: "10" },
    { part: 4, num: 33, text: "Which region has the highest deforestation rate?", type: "multiple_choice", opts: ["A. Asia", "B. Africa", "C. South America", "D. Europe"], ans: "C" },
    { part: 4, num: 34, text: "What percentage of species loss is linked to deforestation?", type: "short_answer", opts: null, ans: "80%" },
    { part: 4, num: 35, text: "The professor mentions ________ as a key solution.", type: "fill_blank", opts: null, ans: "reforestation" },
    { part: 4, num: 36, text: "Carbon sequestration refers to:", type: "multiple_choice", opts: ["A. Burning forests", "B. Absorbing CO2", "C. Planting crops", "D. Mining timber"], ans: "B" },
    { part: 4, num: 37, text: "Indigenous communities protect roughly ________ of the world's biodiversity.", type: "fill_blank", opts: null, ans: "80%" },
    { part: 4, num: 38, text: "The UN target is to restore ________ million hectares by 2030.", type: "fill_blank", opts: null, ans: "350" },
    { part: 4, num: 39, text: "What consumer behaviour drives deforestation most?", type: "short_answer", opts: null, ans: "meat consumption" },
    { part: 4, num: 40, text: "The professor concludes that the most urgent action is:", type: "multiple_choice", opts: ["A. Policy reform", "B. Public education", "C. Technological innovation", "D. International treaties"], ans: "A" },
  ];

  for (const q of listeningQs) {
    await insertQuestion(exam.id, "listening", q.part, q.num, q.text, q.type, q.opts, q.ans);
  }

  // ── Reading: 3 passages ───────────────────────────────────────────
  const p1 = await insertReadingPassage(exam.id, 1, "The History of the Internet",
    `The internet, as we know it today, emerged from a series of innovations spanning several decades. Its origins trace back to the 1960s when the US Defense Department developed ARPANET, a network designed to survive nuclear attacks by enabling decentralised communication. Unlike traditional telephone networks, which relied on dedicated circuits, ARPANET used packet switching—a method of breaking data into small chunks transmitted independently across the network.

During the 1970s, researchers developed TCP/IP (Transmission Control Protocol/Internet Protocol), the foundational language that allows different computers to communicate. Vinton Cerf and Robert Kahn, often called the "fathers of the internet," were instrumental in this development. By the 1980s, universities and research institutions had adopted these protocols, creating a global academic network.

The transformation from a research tool to a public utility came with Tim Berners-Lee's invention of the World Wide Web in 1989. Working at CERN, Berners-Lee created a system of linked documents accessible via browsers, making the internet navigable for ordinary users. The introduction of Mosaic, the first graphical browser, in 1993 sparked a dramatic increase in internet adoption.

The commercialisation of the internet accelerated through the 1990s, giving rise to the dot-com boom. Entrepreneurs recognised the potential for e-commerce, online advertising, and digital services. Although the dot-com bubble burst in 2000, the infrastructure and cultural shifts it produced were permanent. Today, the internet connects over five billion users worldwide and underpins virtually every sector of modern economies.`
  );

  const p2 = await insertReadingPassage(exam.id, 2, "Urban Biodiversity",
    `Cities are often perceived as ecological wastelands—concrete jungles hostile to wildlife. Yet research over the past two decades has challenged this assumption, revealing that urban environments can support surprisingly rich biodiversity. Some species not only survive in cities but thrive there, exploiting resources unavailable in rural areas.

Several factors make cities attractive to certain species. First, urban heat islands—where buildings and pavement absorb and re-emit solar energy—create warmer microclimates that allow temperature-sensitive species to extend their ranges poleward. Peregrine falcons, for instance, have established breeding populations on city skyscrapers across Europe and North America, using buildings as surrogate cliffs. Second, parks, gardens, street trees, and green roofs provide habitat corridors enabling species movement between fragmented natural areas.

However, urban biodiversity is not uniformly distributed. Research consistently shows that wealthier neighbourhoods contain more trees, larger gardens, and a greater variety of bird species than poorer areas—a phenomenon sometimes called the "luxury effect." This inequality has conservation and public health implications, since contact with nature has documented benefits for mental wellbeing.

Conservation efforts are increasingly focusing on "nature-based solutions" that integrate ecological functions into urban design. Green infrastructure, such as bioswales, living walls, and pollinator corridors, can increase urban biodiversity while simultaneously managing stormwater, reducing heat, and improving air quality. Several cities, including Singapore and Vienna, have become global models for biophilic urban planning—designing cities that work with nature rather than against it.`
  );

  const p3 = await insertReadingPassage(exam.id, 3, "The Psychology of Procrastination",
    `Procrastination—the act of delaying or postponing tasks—is one of the most universal human experiences, yet it remains widely misunderstood. Contrary to popular belief, procrastination is not primarily a problem of time management but rather of emotion regulation. People procrastinate not because they are lazy or disorganised, but because they struggle to manage negative emotions associated with particular tasks.

Research by psychologist Fuschia Sirois and others has demonstrated that procrastination is most likely to occur when a task triggers feelings of anxiety, boredom, self-doubt, or frustration. The procrastinator gains immediate mood relief by avoiding the task, but this relief is short-lived; unfinished tasks accumulate, creating greater stress and perpetuating a cycle of avoidance. This pattern has real consequences: chronic procrastinators report poorer health outcomes, largely because they delay medical appointments and healthy behaviours.

Perfectionism is closely related to procrastination, though not identical. Perfectionists may procrastinate because fear of producing imperfect work paralyses them; however, many procrastinators are not perfectionists and simply avoid tasks they find aversive. The distinction matters because interventions differ: a perfectionist benefits most from challenging all-or-nothing thinking, while a non-perfectionist may respond better to strategies that make tasks more immediately rewarding.

Effective interventions share a common theme: they reduce the emotional friction associated with starting a task. Techniques such as "implementation intentions" (specifying when, where, and how one will act), self-compassion (responding to failure with kindness rather than self-criticism), and breaking tasks into small steps have all shown promise in controlled studies. Crucially, researchers emphasise that addressing procrastination requires understanding its emotional roots, not simply imposing stricter schedules.`
  );

  // Reading questions: 40 total (approx 13-14 per passage)
  const readingQs = [
    // Passage 1 - Internet (Q1-13)
    { part: 1, num: 1,  text: "ARPANET was designed to allow communication to continue after a nuclear attack.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 1, num: 2,  text: "TCP/IP was developed in the 1960s.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 1, num: 3,  text: "Tim Berners-Lee invented the first graphical web browser.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 1, num: 4,  text: "Mosaic was introduced in 1993.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 1, num: 5,  text: "The dot-com bubble had no lasting impact on society.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 1, num: 6,  text: "The internet currently connects more than five billion users.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 1, num: 7,  text: "Which method does packet switching use?", type: "multiple_choice", opts: ["A. Dedicated circuits", "B. Breaking data into small chunks", "C. Satellite transmission", "D. Fibre optic cables"], ans: "B" },
    { part: 1, num: 8,  text: "Vinton Cerf and Robert Kahn developed ________ .", type: "fill_blank", opts: null, ans: "TCP/IP" },
    { part: 1, num: 9,  text: "The World Wide Web was invented in ________ .", type: "fill_blank", opts: null, ans: "1989" },
    { part: 1, num: 10, text: "Berners-Lee was working at ________ when he invented the Web.", type: "fill_blank", opts: null, ans: "CERN" },
    { part: 1, num: 11, text: "What sparked dramatic internet adoption in the 1990s?", type: "multiple_choice", opts: ["A. TCP/IP", "B. ARPANET", "C. Mosaic browser", "D. Dot-com stocks"], ans: "C" },
    { part: 1, num: 12, text: "What type of network did ARPANET use?", type: "short_answer", opts: null, ans: "packet switching" },
    { part: 1, num: 13, text: "The internet is described as underpinning which sector?", type: "short_answer", opts: null, ans: "modern economies" },
    // Passage 2 - Urban Biodiversity (Q14-27)
    { part: 2, num: 14, text: "All cities are hostile environments for wildlife.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 2, num: 15, text: "Urban heat islands can allow species to extend their ranges.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 2, num: 16, text: "Peregrine falcons use city buildings as substitute cliffs.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 2, num: 17, text: "The 'luxury effect' refers to the higher biodiversity in wealthier neighbourhoods.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 2, num: 18, text: "Contact with nature has no proven benefit for mental health.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 2, num: 19, text: "Singapore and Vienna are mentioned as examples of:", type: "multiple_choice", opts: ["A. High-pollution cities", "B. Biophilic urban planning", "C. Cities with no wildlife", "D. Cities with luxury housing"], ans: "B" },
    { part: 2, num: 20, text: "Green ________ can increase urban biodiversity while managing stormwater.", type: "fill_blank", opts: null, ans: "infrastructure" },
    { part: 2, num: 21, text: "Urban biodiversity research spans approximately ________ decades.", type: "fill_blank", opts: null, ans: "two" },
    { part: 2, num: 22, text: "What enables species movement between fragmented areas?", type: "short_answer", opts: null, ans: "habitat corridors" },
    { part: 2, num: 23, text: "Bioswales are an example of:", type: "multiple_choice", opts: ["A. Road infrastructure", "B. Green infrastructure", "C. Air quality sensors", "D. Urban heating"], ans: "B" },
    { part: 2, num: 24, text: "Research shows urban biodiversity is not ________ distributed.", type: "fill_blank", opts: null, ans: "uniformly" },
    { part: 2, num: 25, text: "What factor FIRST makes cities attractive to certain species according to the passage?", type: "short_answer", opts: null, ans: "urban heat islands" },
    { part: 2, num: 26, text: "Which bird is specifically mentioned as thriving in cities?", type: "short_answer", opts: null, ans: "peregrine falcon" },
    { part: 2, num: 27, text: "Living walls and pollinator corridors are examples of what?", type: "short_answer", opts: null, ans: "green infrastructure" },
    // Passage 3 - Procrastination (Q28-40)
    { part: 3, num: 28, text: "Procrastination is mainly a time management problem.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 3, num: 29, text: "All procrastinators are perfectionists.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 3, num: 30, text: "Chronic procrastinators tend to have poorer health outcomes.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 3, num: 31, text: "Self-compassion helps reduce procrastination.", type: "true_false_ng", opts: null, ans: "TRUE" },
    { part: 3, num: 32, text: "Implementing stricter schedules is the most effective anti-procrastination strategy.", type: "true_false_ng", opts: null, ans: "FALSE" },
    { part: 3, num: 33, text: "Procrastination is triggered by:", type: "multiple_choice", opts: ["A. Lack of intelligence", "B. Negative emotions about tasks", "C. Poor memory", "D. Overconfidence"], ans: "B" },
    { part: 3, num: 34, text: "What do all effective procrastination interventions share?", type: "short_answer", opts: null, ans: "reducing emotional friction" },
    { part: 3, num: 35, text: "Implementation intentions involve specifying when, where, and ________ one will act.", type: "fill_blank", opts: null, ans: "how" },
    { part: 3, num: 36, text: "Which researcher is specifically mentioned in the passage?", type: "short_answer", opts: null, ans: "Fuschia Sirois" },
    { part: 3, num: 37, text: "The best intervention for perfectionists is:", type: "multiple_choice", opts: ["A. Stricter deadlines", "B. Challenging all-or-nothing thinking", "C. Making tasks more rewarding", "D. Breaking into steps"], ans: "B" },
    { part: 3, num: 38, text: "Procrastinators gain ________ mood relief by avoiding tasks.", type: "fill_blank", opts: null, ans: "immediate" },
    { part: 3, num: 39, text: "Why do chronic procrastinators report poorer health?", type: "short_answer", opts: null, ans: "they delay medical appointments" },
    { part: 3, num: 40, text: "Procrastination is described as a cycle of ________ .", type: "fill_blank", opts: null, ans: "avoidance" },
  ];

  for (const q of readingQs) {
    await insertQuestion(exam.id, "reading", q.part, q.num, q.text, q.type, q.opts, q.ans);
  }

  // ── Writing tasks ─────────────────────────────────────────────────
  await insertWritingTask(exam.id, 1,
    `The graph below shows the percentage of households with internet access in four countries between 2000 and 2020.

Summarise the information by selecting and reporting the main features, and make comparisons where relevant.

Write at least 150 words.`
  );
  await insertWritingTask(exam.id, 2,
    `Some people believe that cities should prioritise the creation of green spaces such as parks and gardens over the construction of new buildings and infrastructure.

To what extent do you agree or disagree with this view?

Give reasons for your answer and include any relevant examples from your own knowledge or experience.

Write at least 250 words.`
  );

  // ── Speaking questions ────────────────────────────────────────────
  const speakingQs = [
    // Part 1
    { part: 1, num: 1, text: "Let's talk about your hometown. Where are you from?" },
    { part: 1, num: 2, text: "What do you like most about your hometown?" },
    { part: 1, num: 3, text: "Do you think your hometown has changed a lot in recent years? How?" },
    { part: 1, num: 4, text: "Let's talk about technology. How often do you use the internet?" },
    { part: 1, num: 5, text: "What do you mainly use the internet for — work, study, or entertainment?" },
    // Part 2
    { part: 2, num: 1, text: "Describe a book or article you have read that you found interesting.\n\nYou should say:\n• what it was about\n• when you read it\n• why you found it interesting\n• and explain what you learned from it.\n\nYou have 1 minute to prepare. Then speak for 1–2 minutes." },
    // Part 3
    { part: 3, num: 1, text: "In your opinion, why do some people prefer reading digital content over printed books?" },
    { part: 3, num: 2, text: "How has the internet changed the way people access information compared to 20 years ago?" },
    { part: 3, num: 3, text: "Do you think social media has had a positive or negative effect on communication? Why?" },
    { part: 3, num: 4, text: "What role should governments play in regulating online content?" },
  ];

  for (const q of speakingQs) {
    await insertSpeakingQuestion(exam.id, q.part, q.num, q.text);
  }

  await activateExam(exam.id);
  console.log(`✅ Sample IELTS exam seeded (ID: ${exam.id})`);
}
