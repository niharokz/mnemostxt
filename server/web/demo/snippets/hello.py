"""A tiny example."""
from dataclasses import dataclass


@dataclass
class Note:
    title: str
    words: int = 0

    def summary(self) -> str:
        return f"{self.title}: {self.words} words"  # f-string


if __name__ == "__main__":
    for n in [Note("todo", 12), Note("plan", 40)]:
        print(n.summary())
