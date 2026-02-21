const BASE_URL = "https://ai-resume-backend-t7lo.onrender.com";

let currentQuestion = "";

async function uploadResume() {
    const fileInput = document.getElementById("resumeInput");
    const formData = new FormData();
    formData.append("resume", fileInput.files[0]);

    const res = await fetch(`${BASE_URL}/analyze-resume`, {
        method: "POST",
        body: formData
    });

    const data = await res.json();
    document.getElementById("result").innerText = data.message || "Resume analyzed successfully!";
}

async function generateQuestions() {
    const res = await fetch(`${BASE_URL}/generate-questions`, {
        method: "POST"
    });

    const data = await res.json();
    currentQuestion = data.question;

    document.getElementById("questions").innerText = currentQuestion;
}

async function submitAnswer() {
    const answer = document.getElementById("answerInput").value;

    const res = await fetch(`${BASE_URL}/evaluate-answer`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            question: currentQuestion,
            answer: answer
        })
    });

    const data = await res.json();
    document.getElementById("feedback").innerText = data.feedback;
}