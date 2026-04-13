import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { Message } from "@/types";

describe("MessageBubble", () => {
  it("renders user message", () => {
    const msg: Message = {
      id: "1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
    };
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders assistant message", () => {
    const msg: Message = {
      id: "2",
      role: "assistant",
      content: "Hi there",
      createdAt: new Date(),
    };
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });
});
