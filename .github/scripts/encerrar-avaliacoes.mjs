#!/usr/bin/env node
/**
 * .github/scripts/encerrar-avaliacoes.mjs
 * Workflow manual/agendado para encerramento de entregas:
 * 1. Lista todos os Pull Requests abertos para a branch main.
 * 2. Filtra pela turma solicitada (ou todas as turmas).
 * 3. Inspeciona o código, consulta a IA, registra as notas oficiais no D1 e comenta no PR.
 * 4. Faz o Merge (Squash) de todos os Pull Requests avaliados para a branch main.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { inspecionarSubpasta } from "../../validar-local.mjs";

const API_BASE = (process.env.PROJETOS_API_BASE || "https://frank-active-reader.frank-alcantara.workers.dev").replace(/\/+$/, "");
const VALIDATION_TOKEN = process.env.PROJETOS_VALIDATION_TOKEN || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || "").trim();
const DEEPSEEK_MODEL = (process.env.DEEPSEEK_MODEL || "deepseek-flash").trim();
const REPO = process.env.GITHUB_REPOSITORY || "frankalcantara/Avalia2026-2";
const TURMA_FILTRO = (process.env.TURMA_FILTRO || "todas").trim().toUpperCase();

const KEY_REGEX = /^(P26|T26)-(2A|2B|2C|2D|3A|3B)-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

async function githubApi(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `https://api.github.com${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function comentarNoPr(prNumber, markdown) {
  if (!GITHUB_TOKEN || !prNumber) return;
  await githubApi(`/repos/${REPO}/issues/${prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: markdown }),
  });
}

async function adicionarLabelsNoPr(prNumber, labels) {
  if (!GITHUB_TOKEN || !prNumber || !labels.length) return;
  await githubApi(`/repos/${REPO}/issues/${prNumber}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels }),
  });
}

async function listarArquivosDoPr(prNumber) {
  const files = [];
  let page = 1;
  while (page <= 10) {
    const { ok, data } = await githubApi(`/repos/${REPO}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    if (!ok || !Array.isArray(data) || data.length === 0) break;
    for (const item of data) {
      files.push(item.filename);
    }
    if (data.length < 100) break;
    page++;
  }
  return files;
}

async function consultarAiEvaluation({ student, project, isTest, checks, dossier }) {
  if (DEEPSEEK_API_KEY) {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Você é o avaliador assistente da disciplina do Prof. Frank de Alcantara. Retorne um JSON com { scores: { deploy (0-25), backend (0-25), frontend (0-15), agents (0-25), repo (0-10) }, summary, strengths: [], improvements: [] }.",
            },
            {
              role: "user",
              content: `Modalidade: ${isTest ? "Teste Sem Nota" : "Oficial"}\nAluno: ${student.nomeCompleto}\nProjeto #${project.id}: ${project.title}\nDescrição: ${project.description}\nChecks: ${JSON.stringify(checks)}\nDossiê:\n${String(dossier).slice(0, 50000)}`,
            },
          ],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          return { ...JSON.parse(content), modelUsed: `deepseek/${DEEPSEEK_MODEL}` };
        }
      } else {
        console.warn(`[DeepSeek API] Status ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.warn("[DeepSeek API] Erro na consulta:", err.message);
    }
  }

  if (GITHUB_TOKEN) {
    try {
      const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Você é o avaliador assistente da disciplina do Prof. Frank de Alcantara. Retorne um JSON com { scores: { deploy (0-25), backend (0-25), frontend (0-15), agents (0-25), repo (0-10) }, summary, strengths: [], improvements: [] }.",
            },
            {
              role: "user",
              content: `Modalidade: ${isTest ? "Teste Sem Nota" : "Oficial"}\nAluno: ${student.nomeCompleto}\nProjeto #${project.id}: ${project.title}\nDescrição: ${project.description}\nChecks: ${JSON.stringify(checks)}\nDossiê:\n${String(dossier).slice(0, 28000)}`,
            },
          ],
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) return null;
      return { ...JSON.parse(content), modelUsed: "github-models/gpt-4o-mini" };
    } catch {
      return null;
    }
  }

  return null;
}

async function main() {
  console.log(`==================================================================`);
  console.log(`  RODADA DE ENCERRAMENTO E AVALIAÇÃO DE ENTREGAS COM IA`);
  console.log(`  Filtro de Turma: ${TURMA_FILTRO}`);
  console.log(`  Repositório: ${REPO}`);
  console.log(`==================================================================\n`);

  // 1. Buscar todos os PRs abertos
  const { ok, data: openPrs } = await githubApi(`/repos/${REPO}/pulls?state=open&per_page=100`);
  if (!ok || !Array.isArray(openPrs) || openPrs.length === 0) {
    console.log("Nenhum Pull Request aberto encontrado para avaliar.");
    return;
  }

  console.log(`Total de PRs abertos encontrados: ${openPrs.length}\n`);

  const results = [];

  for (const pr of openPrs) {
    const prNumber = pr.number;
    console.log(`--- Processando PR #${prNumber} (${pr.title}) ---`);

    const changedFiles = await listarArquivosDoPr(prNumber);
    const topFolders = new Set();
    let invalidIsolation = false;

    for (const file of changedFiles) {
      const parts = file.split("/");
      if (parts.length < 2) {
        invalidIsolation = true;
      } else {
        topFolders.add(parts[0].toUpperCase());
      }
    }

    if (invalidIsolation || topFolders.size !== 1) {
      console.warn(`[PR #${prNumber}] Violação de isolamento de subpasta. Ignorando.`);
      continue;
    }

    const chave = Array.from(topFolders)[0];
    if (!KEY_REGEX.test(chave)) {
      console.warn(`[PR #${prNumber}] Nome de pasta inválido: ${chave}. Ignorando.`);
      continue;
    }

    // 2. Validar a chave no Worker Cloudflare D1
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Avalia2026-BatchEvaluator/1.0",
    };
    if (VALIDATION_TOKEN) headers.Authorization = `Bearer ${VALIDATION_TOKEN}`;

    const validarUrl = `${API_BASE}/api/projetos2026/validar?chave=${encodeURIComponent(chave)}`;
    const valRes = await fetch(validarUrl, { headers });
    const valData = await valRes.json().catch(() => ({}));

    if (!valRes.ok || !valData.valid) {
      console.warn(`[PR #${prNumber}] Chave ${chave} não validada no banco. Ignorando.`);
      continue;
    }

    const { student, project, isTest } = valData;

    // Filtro por turma
    if (TURMA_FILTRO !== "TODAS" && student.turma.toUpperCase() !== TURMA_FILTRO) {
      console.log(`[PR #${prNumber}] Turma ${student.turma} não corresponde ao filtro ${TURMA_FILTRO}. Pulando.`);
      continue;
    }

    console.log(`[PR #${prNumber}] Aluno: ${student.nomeCompleto} | RA: ${student.ra} | Turma: ${student.turma} | Projeto #${project.id}`);

    // 3. Fazer checkout dos arquivos do PR para a subpasta local
    try {
      execSync(`git fetch origin pull/${prNumber}/head:pr-${prNumber} --depth 1`, { stdio: "ignore" });
      execSync(`git checkout pr-${prNumber} -- ${chave}`, { stdio: "ignore" });
    } catch (err) {
      console.error(`[PR #${prNumber}] Falha ao baixar arquivos do PR:`, err.message);
      continue;
    }

    const folderPath = path.resolve(process.cwd(), chave);
    if (!fs.existsSync(folderPath)) {
      console.warn(`[PR #${prNumber}] Pasta local ${chave} não encontrada após checkout.`);
      continue;
    }

    // 4. Inspecionar subpasta e executar avaliação
    const { checks, cloudflareUrl, dossier } = await inspecionarSubpasta(folderPath, chave, { checkLiveUrl: true });

    const externalAiEvaluation = await consultarAiEvaluation({
      student,
      project,
      isTest,
      checks,
      dossier,
    });

    const evalRes = await fetch(`${API_BASE}/api/projetos2026/avaliar`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chave,
        prNumber,
        prUrl: pr.html_url,
        githubRepoUrl: pr.head?.repo?.html_url || "",
        cloudflareUrl,
        checks,
        dossier,
        externalAiEvaluation,
      }),
    });

    const evalData = await evalRes.json().catch(() => null);
    if (!evalRes.ok || !evalData?.ok) {
      console.error(`[PR #${prNumber}] Erro ao chamar avaliador:`, evalData?.message);
      continue;
    }

    console.log(`[PR #${prNumber}] Avaliação IA concluída com sucesso! Nota: ${evalData.scoreTotal}/100 pts.`);

    // 5. Postar o comentário final de nota no PR
    await comentarNoPr(prNumber, evalData.markdownReport);

    // 6. Fazer o Merge (Squash) do Pull Request
    let mergedOk = false;
    try {
      execSync(
        `gh pr merge ${prNumber} --squash --repo ${REPO} --subject "Entrega Oficial ${chave} — ${student.nomeCompleto} (RA ${student.ra})"`,
        {
          stdio: "inherit",
          env: { ...process.env, GH_TOKEN: GITHUB_TOKEN },
        }
      );
      mergedOk = true;
      console.log(`[PR #${prNumber}] ✓ Pull Request mesclado na main via gh CLI!`);
    } catch (err) {
      console.warn(`[PR #${prNumber}] Falha no merge via gh CLI:`, err.message);
    }

    const labels = [`turma:${student.turma}`, `nota:${evalData.scoreTotal}`, "status:avaliado"];
    await adicionarLabelsNoPr(prNumber, labels);

    results.push({
      prNumber,
      aluno: student.nomeCompleto,
      ra: student.ra,
      turma: student.turma,
      chave,
      projeto: `#${project.id}`,
      nota: evalData.scoreTotal,
      merged: mergedOk,
    });
  }

  console.log(`\n==================================================================`);
  console.log(`  RESUMO DA RODADA DE AVALIAÇÃO (${results.length} PRs processados)`);
  console.log(`==================================================================`);
  console.table(results);
}

main();
