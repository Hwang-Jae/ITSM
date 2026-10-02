const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { createClient } = require("@clickhouse/client");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 제공해주신 ClickHouse 접속 정보 설정 (포트 8123 HTTP 인터페이스)
const client = createClient({
  url: "http://localhost:8123",
  username: "default",
  password: "clickhouse",
  database: "default",
  request_timeout: 10000,
});

// 서버 기동 시 RequestMaster 테이블 자동 확인 및 생성
async function initDatabase() {
  try {
    await client.command({
      query: `
                CREATE TABLE IF NOT EXISTS RequestMaster (
                    ReqID String,
                    SystemType LowCardinality(String),
                    Title String,
                    CurrentStatus String,
                    ImprovementRequest String,
                    Content String,
                    Status LowCardinality(String) DEFAULT '접수',
                    Requester String,
                    TargetDate Nullable(Date),
                    RegDate DateTime DEFAULT now()
                ) ENGINE = MergeTree()
                ORDER BY (RegDate, ReqID);
            `,
    });
    console.log("✅ ClickHouse: RequestMaster 테이블이 준비되었습니다.");
  } catch (err) {
    console.error("❌ ClickHouse 테이블 초기화 실패:", err.message);
  }
}

// 1. 전체 요청 목록 조회
app.get("/api/requests", async (req, res) => {
  try {
    const resultSet = await client.query({
      query: "SELECT * FROM RequestMaster ORDER BY RegDate DESC",
      format: "JSONEachRow",
    });
    const dataset = await resultSet.json();
    res.json(dataset);
  } catch (err) {
    console.error("조회 오류:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. 신규 요청 상신 (POST)
app.post("/api/requests", async (req, res) => {
  try {
    const {
      systemType,
      title,
      currentStatus,
      improvementRequest,
      content,
      requester,
      targetDate,
    } = req.body;

    // 보기 쉬운 일련번호 생성 (예: REQ-241001-3829)
    const datePrefix = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const reqId = `REQ-${datePrefix}-${randomSuffix}`;

    const insertRow = {
      ReqID: reqId,
      SystemType: systemType || "Etc",
      Title: title,
      CurrentStatus: currentStatus || "",
      ImprovementRequest: improvementRequest || "",
      Content: content || "",
      Status: "접수",
      Requester: requester || "상신자",
      TargetDate: targetDate && targetDate.trim() !== "" ? targetDate : null,
    };

    await client.insert({
      table: "RequestMaster",
      values: [insertRow],
      format: "JSONEachRow",
    });

    res.status(201).json({ message: "Request created successfully", reqId });
  } catch (err) {
    console.error("상신 저장 오류:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. 상태 업데이트 (PATCH) - ClickHouse ALTER UPDATE 실행
app.patch("/api/requests/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!status) {
      return res.status(400).json({ error: "상태 값이 필요합니다." });
    }

    // ClickHouse Mutation (UPDATE)
    await client.command({
      query: `
                ALTER TABLE RequestMaster 
                UPDATE Status = {newStatus: String} 
                WHERE ReqID = {targetId: String}
            `,
      query_params: {
        newStatus: status,
        targetId: id,
      },
    });

    res.json({ message: "Status update initiated successfully", id, status });
  } catch (err) {
    console.error("상태 업데이트 오류:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. ClickHouse 연결 헬스체크
app.get("/api/health", async (req, res) => {
  try {
    const pingResult = await client.ping();
    if (pingResult.success) {
      res.json({ status: "ok", engine: "ClickHouse" });
    } else {
      res.status(503).json({ status: "fail", error: pingResult.error });
    }
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 ClickHouse 전자 결재 서버 구동 중: http://localhost:${PORT}`);
  console.log(`📡 ClickHouse 연결 대상: http://localhost:8123 (DB: default)`);
  console.log(`===============================================`);
  await initDatabase();
});
