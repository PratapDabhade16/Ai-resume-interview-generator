import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import { createRequire } from "module";

dotenv.config();

/* -------------------- pdf-parse FIX (Windows + Node 22) -------------------- */
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

/* -------------------- App setup -------------------- */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));


/* -------------------- Ensure uploads folder exists -------------------- */
const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

/* -------------------- Multer setup -------------------- */
const upload = multer({ dest: UPLOAD_DIR });

/* -------------------- Groq API call (FREE) -------------------- */
async function getInterviewQuestions(prompt) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY missing in .env file");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        // ✅ CURRENTLY SUPPORTED MODEL
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 800,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

/* -------------------- Upload resume & generate questions -------------------- */
app.post("/generate", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No resume uploaded" });
    }

    const { role, experience, difficulty } = req.body;

    if (!role || !experience || !difficulty) {
      safeDelete(req.file.path);
      return res.status(400).json({ error: "Missing fields" });
    }

    /* Read & parse PDF */
    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(dataBuffer);

    const resumeText = pdfData.text?.substring(0, 3000);

    if (!resumeText || resumeText.trim().length < 50) {
      safeDelete(req.file.path);
      return res
        .status(400)
        .json({ error: "Resume text could not be extracted" });
    }

    /* Prompt */
    const prompt = `
You are a professional technical interviewer.

Resume:
${resumeText}

Job Role: ${role}
Experience Level: ${experience}
Difficulty: ${difficulty}

Generate:
1) 5 technical interview questions
2) 3 real-world scenario questions
3) 2 coding questions based on skills
`;

    const aiResponse = await getInterviewQuestions(prompt);

    const questions =
      aiResponse.choices?.[0]?.message?.content ||
      "No questions generated";

    safeDelete(req.file.path);

    res.json({ questions });
  } catch (error) {
    console.error("ERROR 👉", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* -------------------- Safe file delete -------------------- */
function safeDelete(path) {
  if (path && fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
}

/* -------------------- Start server -------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
