import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import { createRequire } from "module";
import OpenAI from "openai";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/generate", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No resume file uploaded" });
    }

    const { role, experience, difficulty } = req.body;
    if (!role || !experience || !difficulty) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const dataBuffer = fs.readFileSync(req.file.path);

    // ✅ FINAL FIX HERE
    const pdfParser = pdfParse.default || pdfParse;
    const pdfData = await pdfParser(dataBuffer);

    const resumeText = pdfData.text.substring(0, 3000);

    const prompt = `
You are an interview expert.

Resume:
${resumeText}

Job Role: ${role}
Experience Level: ${experience}
Difficulty: ${difficulty}

Generate:
1) Technical interview questions
2) Real-world scenario questions
3) One coding question per skill
`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    fs.unlinkSync(req.file.path);

    res.json({
      questions: response.choices[0].message.content,
    });
  } catch (error) {
    console.error("REAL ERROR 👉", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
