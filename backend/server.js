import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import { createRequire } from "module";

dotenv.config();

/* -------------------- pdf-parse FIX -------------------- */
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

/* -------------------- App setup -------------------- */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* -------------------- Uploads folder -------------------- */
const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

/* -------------------- Multer -------------------- */
const upload = multer({ dest: UPLOAD_DIR });

/* -------------------- Round Config -------------------- */
// These thresholds and descriptions apply to ALL job types
const ROUND_CONFIG = {
  1: {
    name: "Foundation",
    difficulty: "easy",
    passThreshold: 6,
    description: "Core knowledge and fundamentals of the candidate's field",
  },
  2: {
    name: "Application",
    difficulty: "medium",
    passThreshold: 7,
    description: "Real-world scenarios and experience-based questions",
  },
  3: {
    name: "Strategy",
    difficulty: "hard",
    passThreshold: 8,
    description: "Advanced problem-solving, leadership, and strategic thinking",
  },
};

/* -------------------- Groq API helper -------------------- */
async function callGroq(prompt, maxTokens = 700) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
    }
  );

  const data = await response.json();

  if (!data.choices || !data.choices[0]) {
    throw new Error("Groq API returned no response");
  }

  return data.choices[0].message.content;
}

/* ================================================
   ROUTE 1 — Analyze Resume
   POST /analyze-resume
   Body: multipart/form-data  →  resume (file)
   Returns: name, role, field, experience, skills,
            interviewStyle, round themes
   ================================================ */
app.post("/analyze-resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "No resume uploaded" });

    // Parse PDF
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    fs.unlinkSync(req.file.path); // clean up

    const resumeText = pdfData.text.substring(0, 3000);

    const prompt = `
You are an expert HR analyst. Analyze the resume below and extract structured information.
This candidate could be from ANY profession: software, medicine, law, finance, marketing,
design, engineering, education, HR, consulting, architecture, hospitality, etc.

Return ONLY a valid JSON object. No extra text. No markdown. No explanation.

{
  "name": "candidate full name or Candidate if not found",
  "role": "exact job title from resume",
  "field": "industry/domain (e.g. Technology, Healthcare, Finance, Marketing, Design)",
  "experience": "Fresher or Junior or Mid-Level or Senior or Expert",
  "skills": ["skill1", "skill2", "up to 10 key skills from resume"],
  "topSkills": ["top 3 most prominent skills"],
  "highlights": ["achievement or project 1", "achievement or project 2", "up to 3 highlights"],
  "interviewStyle": "technical or behavioral or mixed",
  "summary": "2 sentence professional summary",
  "round1Theme": "Foundation round focus for this specific role",
  "round2Theme": "Application round focus for this specific role",
  "round3Theme": "Strategy round focus for this specific role"
}

Resume:
${resumeText}
`;

    const raw = await callGroq(prompt, 800);

    // Clean and parse JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Could not parse resume analysis" });
    }

    const analysis = JSON.parse(jsonMatch[0]);

    res.json({
      success: true,
      analysis,
    });
  } catch (err) {
    console.error("❌ /analyze-resume error:", err.message);
    res.status(500).json({ error: "Failed to analyze resume" });
  }
});

/* ================================================
   ROUTE 2 — Generate Questions for a Round
   POST /generate-questions
   Body: JSON  →  resumeData, roundNumber (1/2/3)
   Returns: questions array, roundInfo
   ================================================ */
app.post("/generate-questions", async (req, res) => {
  try {
    const { resumeData, roundNumber } = req.body;

    if (!resumeData || !roundNumber) {
      return res.status(400).json({ error: "Missing resumeData or roundNumber" });
    }

    const round = ROUND_CONFIG[roundNumber];
    if (!round) {
      return res.status(400).json({ error: "Invalid roundNumber. Use 1, 2, or 3" });
    }

    // Pick correct theme based on round
    const themeMap = {
      1: resumeData.round1Theme || "core fundamentals",
      2: resumeData.round2Theme || "real-world application",
      3: resumeData.round3Theme || "advanced strategy and leadership",
    };

    // Style guide based on interview type
    const styleGuide = {
      technical:
        "Ask knowledge-based questions testing deep understanding of tools, concepts, and methods used in their field.",
      behavioral:
        "Ask behavioral questions using STAR format about real situations, decisions, and outcomes from their experience.",
      mixed:
        "Mix domain knowledge questions with situational/behavioral questions based on their actual background.",
    };

    const prompt = `
You are a senior interviewer conducting a ${round.name} round interview for a ${resumeData.role} position.

CANDIDATE PROFILE:
- Name: ${resumeData.name}
- Role: ${resumeData.role}
- Field: ${resumeData.field}
- Experience Level: ${resumeData.experience}
- Key Skills: ${resumeData.skills?.join(", ")}
- Highlights: ${resumeData.highlights?.join(" | ")}

ROUND DETAILS:
- Round: ${roundNumber} of 3 — ${round.name}
- Difficulty: ${round.difficulty.toUpperCase()}
- Focus Area: ${themeMap[roundNumber]}
- Interview Style: ${styleGuide[resumeData.interviewStyle] || styleGuide.mixed}

STRICT RULES:
1. Generate EXACTLY 5 questions
2. Every question MUST reference something specific from their resume (a real skill, project, or experience they mentioned)
3. Questions must be appropriate for ${resumeData.role} in ${resumeData.field} — NOT generic
4. Match the difficulty level: ${round.difficulty.toUpperCase()} for a ${resumeData.experience} professional
5. Output ONLY a numbered list — no headings, no categories, no explanations

FORMAT:
1. Question here
2. Question here
3. Question here
4. Question here
5. Question here
`;

    const raw = await callGroq(prompt, 700);

    // Parse numbered list into array
    const questions = raw
      .split("\n")
      .map((line) => line.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter((line) => line.length > 10);

    res.json({
      success: true,
      roundNumber,
      roundInfo: {
        name: round.name,
        difficulty: round.difficulty,
        passThreshold: round.passThreshold,
        theme: themeMap[roundNumber],
      },
      questions: questions.slice(0, 5),
    });
  } catch (err) {
    console.error("❌ /generate-questions error:", err.message);
    res.status(500).json({ error: "Failed to generate questions" });
  }
});

/* ================================================
   ROUTE 3 — Evaluate a Single Answer
   POST /evaluate-answer
   Body: JSON  →  question, answer, resumeData, roundNumber
   Returns: score, verdict, strengths, weaknesses,
            improvement, passed
   ================================================ */
app.post("/evaluate-answer", async (req, res) => {
  try {
    const { question, answer, resumeData, roundNumber } = req.body;

    if (!question || !answer || !resumeData || !roundNumber) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const round = ROUND_CONFIG[roundNumber];

    const prompt = `
You are a strict but fair interviewer evaluating a ${resumeData.role} candidate in ${resumeData.field}.

Question: "${question}"
Candidate Answer: "${answer}"

Candidate Profile:
- Role: ${resumeData.role}
- Field: ${resumeData.field}
- Experience: ${resumeData.experience}
- Skills: ${resumeData.skills?.join(", ")}
- Round: ${roundNumber} of 3 (${round.name} — ${round.difficulty} difficulty)

Scoring guide for a ${resumeData.experience} ${resumeData.role}:
- 0 to 3: Off-topic or shows no relevant knowledge for this field
- 4 to 5: Weak — vague answer, missing key ${resumeData.field} knowledge
- 6 to 7: Decent — shows understanding but lacks depth or specific examples
- 8 to 9: Strong — specific, well-structured, shows real ${resumeData.field} expertise  
- 10: Exceptional — would impress any senior interviewer in ${resumeData.field}

Return ONLY a valid JSON object. No extra text. No markdown.

{
  "score": <number 0 to 10>,
  "verdict": "STRONG or ADEQUATE or WEAK",
  "strengths": ["specific strength from the answer"],
  "weaknesses": ["specific gap relevant to ${resumeData.role}"],
  "improvement": "one actionable tip specific to this role and field",
  "highlight": "one sentence summary of the answer quality"
}
`;

    const raw = await callGroq(prompt, 600);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Could not parse evaluation" });
    }

    const evaluation = JSON.parse(jsonMatch[0]);

    // Add pass/fail info based on round threshold
    const passed = evaluation.score >= round.passThreshold;

    res.json({
      success: true,
      evaluation: {
        ...evaluation,
        roundThreshold: round.passThreshold,
        passedThisQuestion: passed,
      },
    });
  } catch (err) {
    console.error("❌ /evaluate-answer error:", err.message);
    res.status(500).json({ error: "Failed to evaluate answer" });
  }
});

/* ================================================
   ROUTE 4 — Submit Full Round & Get Result
   POST /submit-round
   Body: JSON  →  resumeData, roundNumber, 
                  questions[], answers[], scores[]
   Returns: roundPassed, averageScore, feedback,
            canProceed, nextRound (if any)
   ================================================ */
app.post("/submit-round", async (req, res) => {
  try {
    const { resumeData, roundNumber, questions, answers, scores } = req.body;

    if (!resumeData || !roundNumber || !questions || !answers || !scores) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const round = ROUND_CONFIG[roundNumber];
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const roundPassed = avgScore >= round.passThreshold;
    const isLastRound = roundNumber === 3;

    // Build a summary prompt for overall round feedback
    const qaPairs = questions
      .map((q, i) => `Q${i + 1}: ${q}\nA${i + 1}: ${answers[i]}\nScore: ${scores[i]}/10`)
      .join("\n\n");

    const prompt = `
You are a senior ${resumeData.field} interviewer summarizing a completed interview round.

Candidate: ${resumeData.name} — ${resumeData.role} (${resumeData.experience})
Round: ${roundNumber} — ${round.name} (${round.difficulty} difficulty)
Average Score: ${avgScore.toFixed(1)} / 10
Pass Threshold: ${round.passThreshold} / 10
Result: ${roundPassed ? "PASSED" : "FAILED"}

Q&A Summary:
${qaPairs}

Write a brief, honest round summary (3 to 4 sentences) covering:
1. Overall performance in this round
2. What they did well
3. Key area they need to improve
4. One specific advice for their next round or job search

Keep it direct and professional. No bullet points. Just a paragraph.
`;

    const feedback = await callGroq(prompt, 400);

    res.json({
      success: true,
      roundNumber,
      roundName: round.name,
      averageScore: parseFloat(avgScore.toFixed(1)),
      passThreshold: round.passThreshold,
      roundPassed,
      canProceed: roundPassed && !isLastRound,
      nextRound: roundPassed && !isLastRound ? roundNumber + 1 : null,
      isLastRound,
      feedback: feedback.trim(),
      scoreBreakdown: scores.map((s, i) => ({
        question: i + 1,
        score: s,
        passed: s >= round.passThreshold,
      })),
    });
  } catch (err) {
    console.error("❌ /submit-round error:", err.message);
    res.status(500).json({ error: "Failed to submit round" });
  }
});

/* ================================================
   ROUTE 5 — Final Interview Report
   POST /final-report
   Body: JSON  →  resumeData, allRoundsData[]
   Returns: overall result, strengths, weaknesses,
            recommendation, final verdict
   ================================================ */
app.post("/final-report", async (req, res) => {
  try {
    const { resumeData, allRoundsData } = req.body;

    if (!resumeData || !allRoundsData) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const roundsPassed = allRoundsData.filter((r) => r.roundPassed).length;
    const overallAvg =
      allRoundsData.reduce((s, r) => s + r.averageScore, 0) /
      allRoundsData.length;
    const allPassed = roundsPassed === allRoundsData.length;

    const roundSummary = allRoundsData
      .map(
        (r) =>
          `Round ${r.roundNumber} (${r.roundName}): ${r.averageScore}/10 — ${r.roundPassed ? "PASSED" : "FAILED"}`
      )
      .join("\n");

    const prompt = `
You are a senior HR director writing a final interview report for a ${resumeData.role} candidate.

Candidate: ${resumeData.name}
Role Applied: ${resumeData.role}
Field: ${resumeData.field}
Experience Level: ${resumeData.experience}

Interview Results:
${roundSummary}

Overall Average: ${overallAvg.toFixed(1)} / 10
Rounds Passed: ${roundsPassed} out of ${allRoundsData.length}

Return ONLY a valid JSON object. No extra text. No markdown.

{
  "overallVerdict": "HIRE or CONSIDER or REJECT",
  "overallScore": ${overallAvg.toFixed(1)},
  "roundsPassed": ${roundsPassed},
  "totalRounds": ${allRoundsData.length},
  "topStrengths": ["strength 1 specific to their performance", "strength 2", "strength 3"],
  "areasToImprove": ["area 1 specific to their role", "area 2"],
  "recommendation": "3 sentence recommendation for this candidate specific to ${resumeData.role} in ${resumeData.field}",
  "nextSteps": "2 sentence advice on what the candidate should do next to improve or prepare"
}
`;

    const raw = await callGroq(prompt, 700);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Could not parse final report" });
    }

    const report = JSON.parse(jsonMatch[0]);

    res.json({
      success: true,
      report: {
        ...report,
        candidateName: resumeData.name,
        roleAssessed: resumeData.role,
        fieldAssessed: resumeData.field,
        allPassed,
      },
    });
  } catch (err) {
    console.error("❌ /final-report error:", err.message);
    res.status(500).json({ error: "Failed to generate final report" });
  }
});

/* -------------------- Health Check -------------------- */
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Interview API is running 🚀" });
});

/* -------------------- Server -------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Routes ready:`);
  console.log(`   POST /analyze-resume     — Upload & analyze resume PDF`);
  console.log(`   POST /generate-questions — Get questions for a round`);
  console.log(`   POST /evaluate-answer    — Evaluate a single answer`);
  console.log(`   POST /submit-round       — Submit round & get result`);
  console.log(`   POST /final-report       — Get final interview report`);
  console.log(`   GET  /health             — Health check`);
});