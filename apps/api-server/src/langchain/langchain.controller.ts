import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { LangChainService } from './langchain.service';
import { RAGService } from './services/rag.service';
import { ApiKeyGuard } from '../gateway/guards/api-key.guard';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages';

@Controller('langchain')
@UseGuards(ApiKeyGuard)
export class LangChainController {
  constructor(
    private readonly langChainService: LangChainService,
    private readonly ragService: RAGService,
  ) {}

  @Post('chat')
  async chat(
    @Request() req,
    @Body() body: { message: string; model?: string },
  ) {
    const clientId = req.client.id;
    const model = await this.langChainService.getChatModel(
      clientId,
      body.model,
    );

    // Invoke the model
    const response = await model.invoke(body.message);

    // Return the content
    return {
      content: response.content,
      metadata: response.response_metadata,
    };
  }

  @Post('stream')
  async stream(
    @Request() req,
    @Body() body: { messages: any[]; model?: string },
    @Res() res: Response,
  ) {
    const clientId = req.client.id;
    const model = await this.langChainService.getChatModel(
      clientId,
      body.model,
    );

    // Convert Vercel AI SDK messages to LangChain messages
    const messages = body.messages.map((m) => {
      if (m.role === 'user') return new HumanMessage(m.content);
      if (m.role === 'assistant') return new AIMessage(m.content);
      if (m.role === 'system') return new SystemMessage(m.content);
      return new HumanMessage(m.content);
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const stream = await model.stream(messages);

    for await (const chunk of stream) {
      if (chunk.content) {
        res.write(chunk.content);
      }
    }

    res.end();
  }

  @Post('rag/query')
  async ragQuery(@Request() req, @Body() body: { question: string }) {
    const clientId = req.client.id;
    const answer = await this.ragService.query(body.question, clientId);
    return { answer };
  }

  @Post('rag/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const clientId = req.client.id;
    // Simple text extraction for now (assuming text file)
    // For PDF/Docx, we need loaders
    const content = file.buffer.toString('utf-8');
    await this.ragService.uploadDocuments([content], clientId);
    return { success: true };
  }
}
